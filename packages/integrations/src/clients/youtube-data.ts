// YouTube Data API v3 — primary metadata source. Quota 10K units/day, 1 unit per videos.list.

const BASE = "https://www.googleapis.com/youtube/v3";

function key(): string {
  const k = process.env.YOUTUBE_API_KEY;
  if (!k) throw new Error("YOUTUBE_API_KEY not set in env");
  return k;
}

export function parseIsoDuration(iso: string | undefined | null): number | null {
  if (!iso) return null;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return null;
  const h = Number(m[1] ?? 0);
  const mi = Number(m[2] ?? 0);
  const s = Number(m[3] ?? 0);
  const total = h * 3600 + mi * 60 + s;
  return total > 0 ? total : null;
}

export type YoutubeVideoMeta = {
  videoId: string;
  title: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  description: string;
  durationSec: number | null;
  viewCount: number | null;
  likeCount: number | null;
  thumbnailUrl: string | null;
};

type ApiVideoItem = {
  id: string;
  snippet?: {
    title?: string;
    channelId?: string;
    channelTitle?: string;
    publishedAt?: string;
    description?: string;
    thumbnails?: Record<string, { url: string; width: number }>;
  };
  contentDetails?: { duration?: string };
  statistics?: { viewCount?: string; likeCount?: string };
};

function pickBiggestThumbnail(
  thumbs: Record<string, { url: string; width: number }> | undefined,
): string | null {
  if (!thumbs) return null;
  const arr = Object.values(thumbs);
  if (arr.length === 0) return null;
  return [...arr].sort((a, b) => b.width - a.width)[0]?.url ?? null;
}

function asPositiveNumber(v: string | undefined): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function mapItem(item: ApiVideoItem): YoutubeVideoMeta {
  return {
    videoId: item.id,
    title: item.snippet?.title ?? "",
    channelId: item.snippet?.channelId ?? "",
    channelTitle: item.snippet?.channelTitle ?? "",
    publishedAt: item.snippet?.publishedAt ?? "",
    description: item.snippet?.description ?? "",
    durationSec: parseIsoDuration(item.contentDetails?.duration),
    viewCount: asPositiveNumber(item.statistics?.viewCount),
    likeCount: asPositiveNumber(item.statistics?.likeCount),
    thumbnailUrl: pickBiggestThumbnail(item.snippet?.thumbnails),
  };
}

export type YoutubeChannelMeta = {
  channelId: string;
  title: string;
  description: string;
  customUrl: string;
  publishedAt: string;
  thumbnailUrl: string | null;
  subscriberCount: number | null;
  videoCount: number | null;
  viewCount: number | null;
  country: string;
  uploadsPlaylistId: string | null;
};

type ApiChannelItem = {
  id?: string;
  snippet?: {
    title?: string;
    description?: string;
    customUrl?: string;
    publishedAt?: string;
    country?: string;
    thumbnails?: Record<string, { url: string; width: number }>;
  };
  statistics?: {
    subscriberCount?: string;
    videoCount?: string;
    viewCount?: string;
  };
  contentDetails?: {
    relatedPlaylists?: { uploads?: string };
  };
};

function mapChannel(item: ApiChannelItem): YoutubeChannelMeta {
  return {
    channelId: item.id ?? "",
    title: item.snippet?.title ?? "",
    description: item.snippet?.description ?? "",
    customUrl: item.snippet?.customUrl ?? "",
    publishedAt: item.snippet?.publishedAt ?? "",
    thumbnailUrl: pickBiggestThumbnail(item.snippet?.thumbnails),
    subscriberCount: asPositiveNumber(item.statistics?.subscriberCount),
    videoCount: asPositiveNumber(item.statistics?.videoCount),
    viewCount: asPositiveNumber(item.statistics?.viewCount),
    country: item.snippet?.country ?? "",
    uploadsPlaylistId: item.contentDetails?.relatedPlaylists?.uploads ?? null,
  };
}

async function fetchChannelMetaRaw(
  query: { id?: string; forHandle?: string },
): Promise<YoutubeChannelMeta | null> {
  try {
    const params = new URLSearchParams({
      part: "snippet,statistics,contentDetails",
      ...(query.id ? { id: query.id } : {}),
      ...(query.forHandle ? { forHandle: query.forHandle } : {}),
      key: key(),
    });
    const res = await fetch(`${BASE}/channels?${params.toString()}`);
    if (!res.ok) return null;
    const json = (await res.json()) as { items?: ApiChannelItem[] };
    const item = json.items?.[0];
    if (!item) return null;
    return mapChannel(item);
  } catch {
    return null;
  }
}

export function fetchChannelMetaById(channelId: string): Promise<YoutubeChannelMeta | null> {
  return fetchChannelMetaRaw({ id: channelId });
}

// 1 quota unit; accepts the handle with or without the leading @.
export function fetchChannelMetaByHandle(
  handle: string,
): Promise<YoutubeChannelMeta | null> {
  const h = handle.startsWith("@") ? handle : `@${handle}`;
  return fetchChannelMetaRaw({ forHandle: h });
}

// /c/name and /user/name are legacy paths the API can't resolve cheaply.
export function parseYoutubeChannelUrl(
  url: string,
): { type: "id"; channelId: string } | { type: "handle"; handle: string } | { type: "legacy" } | null {
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith("youtube.com") && !u.hostname.endsWith("youtu.be")) return null;
    const id = u.pathname.match(/^\/channel\/(UC[\w-]+)/);
    if (id) return { type: "id", channelId: id[1]! };
    const handle = u.pathname.match(/^\/@([\w.-]+)/);
    if (handle) return { type: "handle", handle: handle[1]! };
    if (/^\/(?:c|user)\//.test(u.pathname)) return { type: "legacy" };
    return null;
  } catch {
    return null;
  }
}

// 1 quota unit; null on any failure so callers can fall back.
export async function fetchVideoMetadata(videoId: string): Promise<YoutubeVideoMeta | null> {
  try {
    const url = `${BASE}/videos?part=snippet,contentDetails,statistics&id=${encodeURIComponent(videoId)}&key=${key()}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = (await res.json()) as { items?: ApiVideoItem[] };
    const item = json.items?.[0];
    if (!item) return null;
    return mapItem(item);
  } catch {
    return null;
  }
}

// No proxy: channels.list → playlistItems.list → videos.list, ~3 quota units. Shorts (≤60s) are
// filtered to mirror the yt-dlp /videos-tab behavior. Null when the URL/key can't serve it, so
// the caller keeps its original error.
export async function listChannelUploads(
  channelUrl: string,
  limit: number,
): Promise<YoutubeVideoMeta[] | null> {
  const parsed = parseYoutubeChannelUrl(channelUrl);
  if (!parsed || parsed.type === "legacy") return null;
  const channel =
    parsed.type === "id"
      ? await fetchChannelMetaById(parsed.channelId)
      : await fetchChannelMetaByHandle(parsed.handle);
  if (!channel?.uploadsPlaylistId) return null;
  try {
    // Over-fetch so the Shorts filter still leaves `limit` long-form rows.
    const fetchCount = Math.min(50, Math.max(limit * 2, 10));
    const params = new URLSearchParams({
      part: "contentDetails",
      playlistId: channel.uploadsPlaylistId,
      maxResults: String(fetchCount),
      key: key(),
    });
    const res = await fetch(`${BASE}/playlistItems?${params.toString()}`);
    if (!res.ok) return null;
    const json = (await res.json()) as {
      items?: Array<{ contentDetails?: { videoId?: string } }>;
    };
    const ids = (json.items ?? [])
      .map((i) => i.contentDetails?.videoId)
      .filter((v): v is string => !!v);
    if (ids.length === 0) return null;
    const metas = await fetchVideoMetadataBatch(ids);
    const ordered = ids
      .map((id) => metas.get(id))
      .filter((m): m is YoutubeVideoMeta => !!m);
    const longForm = ordered.filter((m) => (m.durationSec ?? 0) > 60);
    // Shorts-only channels: better the unfiltered list than an empty one.
    return (longForm.length > 0 ? longForm : ordered).slice(0, limit);
  } catch {
    return null;
  }
}

// Still 1 quota unit per video, but a single round-trip per batch.
export async function fetchVideoMetadataBatch(
  videoIds: string[],
): Promise<Map<string, YoutubeVideoMeta>> {
  const result = new Map<string, YoutubeVideoMeta>();
  if (videoIds.length === 0) return result;
  // API allows up to 50 ids per call.
  for (let i = 0; i < videoIds.length; i += 50) {
    const slice = videoIds.slice(i, i + 50);
    try {
      const url = `${BASE}/videos?part=snippet,contentDetails,statistics&id=${slice.map(encodeURIComponent).join(",")}&key=${key()}`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const json = (await res.json()) as { items?: ApiVideoItem[] };
      for (const item of json.items ?? []) {
        result.set(item.id, mapItem(item));
      }
    } catch {
    }
  }
  return result;
}
