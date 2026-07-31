// TikHub rate limit: 1 req/sec per route — caller paces across same endpoint.
import { recordUsage } from "../metering";

const BASE = "https://api.tikhub.io";

function key(): string {
  const k = process.env.TIKHUB_API_KEY;
  if (!k) throw new Error("TIKHUB_API_KEY not set in env");
  return k;
}

async function get<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const url = `${BASE}${endpoint}${qs ? `?${qs}` : ""}`;
  const attempts = 3;
  let lastErr: Error | null = null;
  // 400 is retried too: TikHub returns a transient "Please retry" body under it.
  for (let i = 1; i <= attempts; i++) {
    try {
      // Without a signal this inherits undici's 300s default, and these run inline in tRPC
      // mutations — a silent TikHub stall would hold a Vercel function for minutes per attempt.
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${key()}`, accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
      });
      if ((res.status >= 500 || res.status === 429 || res.status === 400) && i < attempts) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const waitMs = res.status === 429 && retryAfter > 0 ? retryAfter * 1000 : 800 * i;
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`TikHub ${endpoint} HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
      const json = (await res.json()) as { code?: number; data?: T; detail?: unknown };
      if (json.code && json.code !== 200) {
        throw new Error(`TikHub ${endpoint} code ${json.code}: ${JSON.stringify(json).slice(0, 200)}`);
      }
      recordUsage({ resourceType: "scrape", provider: "tikhub", model: endpoint, apiCalls: 1 });
      return (json.data ?? json) as T;
    } catch (err) {
      lastErr = err as Error;
      if (i >= attempts) throw lastErr;
      await new Promise((r) => setTimeout(r, 800 * i));
    }
  }
  throw lastErr ?? new Error(`TikHub ${endpoint} request failed`);
}

export { isValidYoutubeChannelUrl } from "../validators";

export type YouTubeChannelMeta = {
  channel_id: string;
  channel_name: string;
  description: string;
  subscriberCount: number | null;
  videoCount: number | null;
  thumbnail_url: string | null;
};

// TikHub returns counts as display strings like "320K subscribers" or "81 videos".
function parseDisplayCount(input: string | number | undefined | null): number | null {
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  if (!input) return null;
  const m = String(input)
    .replace(/,/g, "")
    .match(/(\d+(?:\.\d+)?)\s*([KMBkmb万千]?)/);
  if (!m) return null;
  const base = parseFloat(m[1]!);
  if (!Number.isFinite(base)) return null;
  const suffix = m[2] ?? "";
  const mult =
    suffix === "K" || suffix === "k"
      ? 1000
      : suffix === "M" || suffix === "m"
        ? 1_000_000
        : suffix === "B" || suffix === "b"
          ? 1_000_000_000
          : suffix === "万"
            ? 10_000
            : suffix === "千"
              ? 1_000
              : 1;
  return Math.round(base * mult);
}

export async function resolveChannelId(channelUrl: string): Promise<string> {
  const data = await get<{ channel_id: string }>(
    "/api/v1/youtube/web/get_channel_id_v2",
    { channel_url: channelUrl },
  );
  return data.channel_id;
}

type RawChannelInfo = {
  channel_id?: string;
  title?: string;
  description?: string;
  subscriber_count?: string | number;
  video_count?: string | number;
  avatar?: Array<{ url?: string; width?: number; height?: number }>;
};

export async function getChannelInfo(channelId: string): Promise<YouTubeChannelMeta> {
  const raw = await get<RawChannelInfo>("/api/v1/youtube/web/get_channel_info", {
    channel_id: channelId,
  });
  const avatars = (raw.avatar ?? []).filter((a) => a.url);
  const biggest = avatars.length
    ? [...avatars].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]
    : null;
  return {
    channel_id: raw.channel_id ?? channelId,
    channel_name: raw.title ?? "",
    description: raw.description ?? "",
    subscriberCount: parseDisplayCount(raw.subscriber_count),
    videoCount: parseDisplayCount(raw.video_count),
    thumbnail_url: biggest?.url ?? null,
  };
}

export type YouTubeVideoRef = {
  video_id: string;
  title: string;
  url?: string;
  view_count?: number;
  duration?: string; // human-readable like "21:13"
  thumbnail?: string;
  published_time?: string;
  description?: string;
  is_live?: boolean;
};

export async function getChannelVideos(channelId: string): Promise<YouTubeVideoRef[]> {
  // TikHub silently deprecated `web_v2/get_channel_videos` — it returns an empty array for
  // every channel; the unversioned route is the working one as of 2026-05-20.
  const data = await get<{ videos?: YouTubeVideoRef[]; continuation_token?: string }>(
    "/api/v1/youtube/web/get_channel_videos",
    { channel_id: channelId },
  );
  return (data.videos ?? []).filter((v) => v.video_id && !v.is_live);
}

export type CaptionTrack = {
  language_code: string;
  language_name: string;
  base_url: string;
  is_translatable?: boolean;
  kind?: string;
};

export type YouTubeVideoInfo = {
  video_id: string;
  title: string;
  url: string;
  views: number;
  duration_sec: number;
  thumbnail_url: string;
  channel_id: string;
  channel_name: string;
  description?: string;
  published_at?: string;
  captions: CaptionTrack[];
};

// `web_v2/get_video_info` returns empty data for Chinese YouTubers; `get_video_streams_v2`
// covers both but omits caption tracks, hence the separate `get_video_captions_v2` call.
export async function getVideoInfo(videoId: string): Promise<YouTubeVideoInfo> {
  const [meta, captionsData] = await Promise.all([
    get<{
      video_id?: string;
      title?: string;
      author?: string;
      channel_id?: string | null;
      length_seconds?: number | string;
      view_count?: number | string;
      short_description?: string;
      thumbnail?: Array<{ url: string; width?: number; height?: number }>;
    }>("/api/v1/youtube/web_v2/get_video_streams_v2", { video_id: videoId }),
    get<{ captions?: CaptionTrack[] }>(
      "/api/v1/youtube/web_v2/get_video_captions_v2",
      { video_id: videoId },
    ).catch(() => ({ captions: [] as CaptionTrack[] })),
  ]);

  const largestThumb =
    meta.thumbnail && meta.thumbnail.length > 0
      ? [...meta.thumbnail].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]
      : undefined;

  const viewsNum =
    typeof meta.view_count === "number" ? meta.view_count : Number(meta.view_count) || 0;
  const lenNum =
    typeof meta.length_seconds === "number"
      ? meta.length_seconds
      : Number(meta.length_seconds) || 0;

  return {
    video_id: meta.video_id ?? videoId,
    title: meta.title ?? "",
    url: `https://www.youtube.com/watch?v=${videoId}`,
    views: viewsNum,
    duration_sec: lenNum,
    thumbnail_url: largestThumb?.url ?? "",
    channel_id: meta.channel_id ?? "",
    channel_name: meta.author ?? "",
    description: meta.short_description,
    captions: captionsData.captions ?? [],
  };
}

// getVideoInfo already returns captions; use this only when the metadata isn't needed.
export async function getCaptionsManifest(videoId: string): Promise<CaptionTrack[]> {
  const data = await get<{ captions?: CaptionTrack[] }>(
    "/api/v1/youtube/web_v2/get_video_captions_v2",
    { video_id: videoId },
  );
  return data.captions ?? [];
}

// fmt=srv3 → `<p>`; bare URL → `<text>`. Some base_urls only honor one — parse both, return first non-empty.
export async function fetchTranscriptText(baseUrl: string): Promise<string> {
  const fetchOne = async (url: string): Promise<string> => {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) throw new Error(`YouTube timedtext HTTP ${res.status}`);
    return res.text();
  };

  const parse = (xml: string): string => {
    const pLines = xml.match(/<p[^>]*>([\s\S]*?)<\/p>/g) ?? [];
    const textLines = xml.match(/<text[^>]*>([\s\S]*?)<\/text>/g) ?? [];
    const lines = pLines.length > 0 ? pLines : textLines;
    return lines
      .map((line) => line.replace(/<[^>]*>/g, ""))
      .join("\n")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
      .trim();
  };

  const urlWithFmt = baseUrl.includes("fmt=") ? baseUrl : `${baseUrl}&fmt=srv3`;
  const xml = await fetchOne(urlWithFmt);
  const text = parse(xml);
  if (text.length > 0) return text;
  if (urlWithFmt !== baseUrl) {
    const fallback = await fetchOne(baseUrl);
    return parse(fallback);
  }
  return "";
}

// Falls through tracks on empty fetch — some YouTube base_urls return 0-byte XML.
export async function transcriptFromTracks(
  tracks: CaptionTrack[],
  preferLangs: string[] = ["en", "zh", "zh-CN", "zh-TW"],
): Promise<{ text: string; languageCode: string } | null> {
  if (tracks.length === 0) return null;
  const sorted = [...tracks].sort((a, b) => {
    const ai = preferLangs.indexOf(a.language_code);
    const bi = preferLangs.indexOf(b.language_code);
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
  for (const track of sorted) {
    try {
      const text = await fetchTranscriptText(track.base_url);
      if (text.length > 0) return { text, languageCode: track.language_code };
    } catch {
    }
  }
  return null;
}

export async function getVideoWithTranscript(
  videoId: string,
  preferLangs: string[] = ["en", "zh", "zh-CN", "zh-TW"],
): Promise<{
  info: YouTubeVideoInfo;
  transcript: { text: string; languageCode: string } | null;
}> {
  const info = await getVideoInfo(videoId);
  const transcript = await transcriptFromTracks(info.captions, preferLangs);
  return { info, transcript };
}

export type AudioStream = {
  itag: number;
  mime_type: string;
  url: string;
  audio_quality?: string;
  content_length?: string;
};

export async function getAudioStreams(videoId: string): Promise<AudioStream[]> {
  const data = await get<{
    adaptive_formats?: AudioStream[];
    streams?: AudioStream[];
  }>("/api/v1/youtube/web_v2/get_video_streams_v2", { video_id: videoId });
  const all = [...(data.adaptive_formats ?? []), ...(data.streams ?? [])];
  return all.filter((s) => s.mime_type?.startsWith("audio/"));
}

export type XhsNoteRef = {
  id: string;
  note_id?: string;
  title?: string;
  type?: "video" | "image" | string;
  user_id?: string;
};

export async function searchXhsNotes(keyword: string): Promise<XhsNoteRef[]> {
  const data = await get<{ items?: XhsNoteRef[] }>(
    "/api/v1/xiaohongshu/app_v2/search_notes",
    { keyword },
  );
  return data.items ?? [];
}
