import { spawn } from "node:child_process";
import { chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { listChannelUploads } from "./youtube-data";

const YTDLP_VERSION = "2026.03.17";
const YTDLP_ASSET = process.platform === "darwin" ? "yt-dlp_macos" : "yt-dlp_linux";
const YTDLP_BIN = join(tmpdir(), `yt-dlp-${YTDLP_VERSION}-${process.platform}`);
const RELEASE_URL = `https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/${YTDLP_ASSET}`;

// Skip live videos (they hang forever), use player clients that don't need a PO Token, and
// kill the stale cache that pollutes re-used container /tmp.
const COMMON_FLAGS = [
  "--no-warnings",
  "--no-progress",
  "--no-cache-dir",
  "--no-mtime",
  "--no-part",
  "--socket-timeout",
  "15",
  "--match-filters",
  "!is_live & live_status!=is_upcoming",
  "--extractor-args",
  "youtube:player_client=web_embedded,android_vr",
];

let ensured = false;

export async function ensureYtdlpBinary(): Promise<string> {
  if (ensured && existsSync(YTDLP_BIN)) return YTDLP_BIN;
  if (existsSync(YTDLP_BIN)) {
    ensured = true;
    return YTDLP_BIN;
  }
  const res = await fetch(RELEASE_URL);
  if (!res.ok || !res.body) throw new Error(`yt-dlp fetch HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(YTDLP_BIN, buf);
  chmodSync(YTDLP_BIN, 0o755);
  ensured = true;
  return YTDLP_BIN;
}

export type YtdlpResult = {
  stdout: string;
  stderr: string;
  code: number | null;
};

export function runYtdlp(args: string[], timeoutMs = 180_000): Promise<YtdlpResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(YTDLP_BIN, args, { timeout: timeoutMs });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, code }));
  });
}

export async function downloadAudioWithYtdlp(args: {
  videoId: string;
  outPath: string;
  proxyUrl: string;
  timeoutMs?: number;
}): Promise<YtdlpResult> {
  await ensureYtdlpBinary();
  return runYtdlp(
    [
      `https://www.youtube.com/watch?v=${args.videoId}`,
      "-f",
      "ba[ext=m4a]/bestaudio",
      "--no-playlist",
      ...COMMON_FLAGS,
      "--proxy",
      args.proxyUrl,
      "-o",
      args.outPath,
    ],
    args.timeoutMs ?? 180_000,
  );
}

export type YtdlpChapter = {
  start_time: number;
  end_time: number;
  title: string;
};

// SponsorBlock chapters live in a SEPARATE field from creator chapters when
// --skip-download is used. Coverage: ~85% on English channels, weak on Chinese.
export type YtdlpSponsorChapter = {
  start_time: number;
  end_time: number;
  category: string;
  type: string;
};

export type YtdlpVideoMetadata = {
  video_id: string;
  title: string;
  url: string;
  views: number;
  duration_sec: number;
  thumbnail_url: string;
  channel_id: string;
  channel_name: string;
  description: string;
  upload_date: string | null;
  // Empty arrays mean caption-first ASR is not available for this video.
  auto_caption_langs: string[];
  manual_caption_langs: string[];
  // Creator-supplied chapter markers (only ~33% of videos have these).
  chapters: YtdlpChapter[];
  // SponsorBlock community-labeled segments: sponsor / selfpromo / intro /
  // outro / hook / interaction / filler / poi_highlight / preview / chapter.
  sponsor_chapters: YtdlpSponsorChapter[];
};

type RawYtdlpInfo = {
  id?: string;
  title?: string;
  webpage_url?: string;
  view_count?: number;
  duration?: number;
  thumbnail?: string;
  thumbnails?: Array<{ url?: string; width?: number; height?: number }>;
  channel_id?: string;
  channel?: string;
  uploader?: string;
  description?: string;
  upload_date?: string;
  automatic_captions?: Record<string, unknown>;
  subtitles?: Record<string, unknown>;
  chapters?: Array<{ start_time?: number; end_time?: number; title?: string }> | null;
  sponsorblock_chapters?: Array<{
    start_time?: number;
    end_time?: number;
    category?: string;
    type?: string;
  }> | null;
};

export async function getVideoMetadataYtdlp(
  videoId: string,
  proxyUrl: string,
  timeoutMs = 60_000,
): Promise<YtdlpVideoMetadata> {
  await ensureYtdlpBinary();
  const r = await runYtdlp(
    [
      `https://www.youtube.com/watch?v=${videoId}`,
      "--dump-single-json",
      "--skip-download",
      "--no-playlist",
      // Populates sponsorblock_chapters[]; silently empty if the SponsorBlock API is down.
      "--sponsorblock-mark",
      "all",
      ...COMMON_FLAGS,
      "--proxy",
      proxyUrl,
    ],
    timeoutMs,
  );
  if (r.code !== 0) {
    throw createYtdlpError(`metadata fetch failed`, r);
  }
  const info = JSON.parse(r.stdout) as RawYtdlpInfo;
  const biggestThumb =
    info.thumbnails && info.thumbnails.length > 0
      ? [...info.thumbnails]
          .filter((t) => t.url)
          .sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]
      : null;
  return {
    video_id: info.id ?? videoId,
    title: info.title ?? "",
    url: info.webpage_url ?? `https://www.youtube.com/watch?v=${videoId}`,
    views: typeof info.view_count === "number" ? info.view_count : 0,
    duration_sec: typeof info.duration === "number" ? info.duration : 0,
    thumbnail_url: biggestThumb?.url ?? info.thumbnail ?? "",
    channel_id: info.channel_id ?? "",
    channel_name: info.channel ?? info.uploader ?? "",
    description: info.description ?? "",
    upload_date: info.upload_date ?? null,
    auto_caption_langs: Object.keys(info.automatic_captions ?? {}),
    manual_caption_langs: Object.keys(info.subtitles ?? {}),
    chapters: Array.isArray(info.chapters)
      ? info.chapters
          .filter(
            (c) => typeof c.start_time === "number" && typeof c.end_time === "number",
          )
          .map((c) => ({
            start_time: c.start_time!,
            end_time: c.end_time!,
            title: c.title ?? "",
          }))
      : [],
    sponsor_chapters: Array.isArray(info.sponsorblock_chapters)
      ? info.sponsorblock_chapters
          .filter(
            (c) =>
              typeof c.start_time === "number" &&
              typeof c.end_time === "number" &&
              typeof c.category === "string",
          )
          .map((c) => ({
            start_time: c.start_time!,
            end_time: c.end_time!,
            category: c.category!,
            type: c.type ?? "skip",
          }))
      : [],
  };
}

export type YtdlpCaptions = {
  text: string;
  words: Array<{ w: string; t: number }>;
  lang: string;
};

type Json3Event = {
  tStartMs?: number;
  dDurationMs?: number;
  segs?: Array<{ utf8?: string; tOffsetMs?: number }>;
};
type Json3Doc = { events?: Json3Event[] };

function parseJson3(raw: string): { text: string; words: Array<{ w: string; t: number }> } {
  const doc = JSON.parse(raw) as Json3Doc;
  const lines: string[] = [];
  const words: Array<{ w: string; t: number }> = [];
  for (const event of doc.events ?? []) {
    if (!event.segs) continue;
    const start = event.tStartMs ?? 0;
    const eventText = event.segs.map((s) => s.utf8 ?? "").join("");
    const cleaned = eventText.replace(/\n/g, " ").trim();
    if (cleaned && cleaned !== "\n") {
      lines.push(cleaned);
      for (const seg of event.segs) {
        const w = (seg.utf8 ?? "").trim();
        if (w && w !== "\n") {
          words.push({ w, t: Math.floor((start + (seg.tOffsetMs ?? 0)) / 1000) });
        }
      }
    }
  }
  return { text: lines.join(" "), words };
}

export async function getAutoCaptionsYtdlp(
  videoId: string,
  preferLangs: string[],
  proxyUrl: string,
  timeoutMs = 60_000,
  logger?: { warn: (msg: string) => void; info: (msg: string) => void },
): Promise<YtdlpCaptions | null> {
  await ensureYtdlpBinary();
  const outDir = tmpdir();
  const outTemplate = join(outDir, `cap-${videoId}-${Date.now()}`);
  const langList = preferLangs.join(",");
  const r = await runYtdlp(
    [
      `https://www.youtube.com/watch?v=${videoId}`,
      "--write-auto-subs",
      "--skip-download",
      "--no-playlist",
      "--ignore-errors",
      "--sub-langs",
      langList,
      "--sub-format",
      "json3",
      ...COMMON_FLAGS,
      "--proxy",
      proxyUrl,
      "-o",
      outTemplate,
    ],
    timeoutMs,
  );
  // Even on exit≠0 yt-dlp may have written files for langs that succeeded before another lang
  // hit 429 — continue and scan disk.
  if (r.code !== 0) {
    logger?.info(
      `yt-dlp captions exited ${r.code} (partial-success possible) stderr=${r.stderr.slice(0, 200)}`,
    );
  }
  // yt-dlp may write captions to either `${outTemplate}.${lang}.json3` or
  // `${cwd-or-default}/${video_id}.${lang}.json3` depending on template handling.
  const fs = await import("node:fs");
  const dirEntries = fs.readdirSync(outDir);
  const myFiles = dirEntries.filter(
    (f) =>
      f.endsWith(".json3") &&
      (f.startsWith(`cap-${videoId}-`) || f.startsWith(videoId)),
  );
  if (myFiles.length === 0) {
    logger?.info(`yt-dlp captions: no .json3 files written for ${videoId} (stderr tail: ${r.stderr.slice(-200)})`);
    return null;
  }
  logger?.info(`yt-dlp captions: found ${myFiles.length} candidate files: ${myFiles.join(", ")}`);

  const candidates: Array<{ path: string; lang: string }> = myFiles.map((f) => {
    const m = f.match(/\.([\w-]+)\.json3$/);
    return { path: join(outDir, f), lang: m ? m[1]! : "unknown" };
  });

  for (const want of preferLangs) {
    const match = candidates.find((c) => c.lang === want || c.lang.startsWith(want + "-"));
    if (!match) continue;
    try {
      const raw = readFileSync(match.path, "utf-8");
      const { text, words } = parseJson3(raw);
      candidates.forEach((c) => {
        try {
          unlinkSync(c.path);
        } catch {
        }
      });
      if (text.length === 0) {
        logger?.warn(`yt-dlp captions: ${match.lang} file parsed to 0 chars`);
        return null;
      }
      return { text, words, lang: match.lang };
    } catch (err) {
      logger?.warn(
        `yt-dlp captions: parse failed for ${match.lang}: ${(err as Error).message?.slice(0, 200)}`,
      );
    }
  }

  if (candidates.length > 0) {
    const first = candidates[0]!;
    try {
      const raw = readFileSync(first.path, "utf-8");
      const { text, words } = parseJson3(raw);
      candidates.forEach((c) => {
        try {
          unlinkSync(c.path);
        } catch {
        }
      });
      if (text.length === 0) return null;
      logger?.info(`yt-dlp captions: fell back to non-preferred lang ${first.lang}`);
      return { text, words, lang: first.lang };
    } catch {
      candidates.forEach((c) => {
        try {
          unlinkSync(c.path);
        } catch {
        }
      });
    }
  }
  return null;
}

export type YtdlpChannelVideo = {
  video_id: string;
  title: string;
  url: string;
  duration_sec: number;
  views: number;
  thumbnail_url: string;
  published_at: string | null;
};

type RawFlatPlaylistEntry = {
  id?: string;
  title?: string;
  url?: string;
  webpage_url?: string;
  duration?: number;
  view_count?: number;
  thumbnails?: Array<{ url?: string; width?: number; height?: number }>;
  thumbnail?: string;
  upload_date?: string;
  timestamp?: number;
  live_status?: string;
  ie_key?: string;
};

function normalizeUploadDate(raw?: string, timestamp?: number): string | null {
  if (timestamp && Number.isFinite(timestamp)) {
    return new Date(timestamp * 1000).toISOString();
  }
  if (!raw || !/^\d{8}$/.test(raw)) return null;
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T00:00:00Z`;
}

export async function listChannelVideosYtdlp(
  channelUrl: string,
  limit: number,
  proxyUrl: string,
  timeoutMs = 120_000,
): Promise<YtdlpChannelVideo[]> {
  await ensureYtdlpBinary();
  // /@handle/videos targets long-form only; falls back gracefully to /@handle root.
  const targetUrl = channelUrl.replace(/\/+$/, "").endsWith("/videos")
    ? channelUrl
    : channelUrl.replace(/\/+$/, "") + "/videos";
  const r = await runYtdlp(
    [
      targetUrl,
      "--flat-playlist",
      "--dump-json",
      "--playlist-end",
      String(limit),
      ...COMMON_FLAGS,
      "--proxy",
      proxyUrl,
    ],
    timeoutMs,
  );
  if (r.code !== 0) {
    throw createYtdlpError(`channel list failed`, r);
  }
  const rows = r.stdout
    .split("\n")
    .filter((s) => s.trim().length > 0)
    .map((line) => JSON.parse(line) as RawFlatPlaylistEntry)
    .filter((e) => e.id && e.live_status !== "is_live" && e.live_status !== "is_upcoming");
  return rows.map((e) => {
    const biggestThumb =
      e.thumbnails && e.thumbnails.length > 0
        ? [...e.thumbnails]
            .filter((t) => t.url)
            .sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]
        : null;
    return {
      video_id: e.id!,
      title: e.title ?? "",
      url: e.webpage_url ?? e.url ?? `https://www.youtube.com/watch?v=${e.id}`,
      duration_sec: typeof e.duration === "number" ? e.duration : 0,
      views: typeof e.view_count === "number" ? e.view_count : 0,
      thumbnail_url: biggestThumb?.url ?? e.thumbnail ?? "",
      published_at: normalizeUploadDate(e.upload_date, e.timestamp),
    };
  });
}

// yt-dlp via proxy (fast path, exact /videos-tab semantics) with a YouTube Data API
// fallback — proxy egress to www.youtube.com periodically read-times-out (D5 family).
export async function listChannelVideos(
  channelUrl: string,
  limit: number,
  proxyUrl: string,
  logger?: { info?: (m: string) => void; warn?: (m: string) => void },
): Promise<YtdlpChannelVideo[]> {
  try {
    // 60s is plenty when the proxy works (~10s); fail fast into the fallback when not.
    return await listChannelVideosYtdlp(channelUrl, limit, proxyUrl, 60_000);
  } catch (err) {
    logger?.warn?.(
      `yt-dlp channel list failed (${(err as Error).message?.slice(0, 120)}), trying YouTube Data API`,
    );
    const metas = await listChannelUploads(channelUrl, limit);
    if (!metas || metas.length === 0) throw err;
    logger?.info?.(`channel list via YouTube Data API fallback: ${metas.length} videos`);
    return metas.map((m) => ({
      video_id: m.videoId,
      title: m.title,
      url: `https://www.youtube.com/watch?v=${m.videoId}`,
      duration_sec: m.durationSec ?? 0,
      views: m.viewCount ?? 0,
      thumbnail_url: m.thumbnailUrl ?? "",
      published_at: m.publishedAt || null,
    }));
  }
}

export async function resolveChannelIdYtdlp(
  channelUrl: string,
  proxyUrl: string,
  timeoutMs = 60_000,
): Promise<string> {
  await ensureYtdlpBinary();
  const r = await runYtdlp(
    [
      channelUrl,
      "--flat-playlist",
      "--playlist-end",
      "1",
      "--print",
      "%(channel_id)s",
      ...COMMON_FLAGS,
      "--proxy",
      proxyUrl,
    ],
    timeoutMs,
  );
  if (r.code !== 0) {
    throw createYtdlpError(`channel resolve failed`, r);
  }
  const channelId = r.stdout.split("\n").find((s) => s.startsWith("UC"))?.trim();
  if (!channelId) throw new Error(`no channel_id in yt-dlp output: ${r.stdout.slice(0, 200)}`);
  return channelId;
}

export type YtdlpComment = {
  text: string;
  author: string | null;
  likes: number;
};

type RawYtdlpInfoWithComments = RawYtdlpInfo & {
  comments?: Array<{
    text?: string;
    author?: string;
    author_id?: string;
    like_count?: number;
  }>;
};

export async function getTopCommentsYtdlp(
  videoId: string,
  proxyUrl: string,
  maxComments = 100,
  timeoutMs = 90_000,
): Promise<YtdlpComment[]> {
  await ensureYtdlpBinary();
  const r = await runYtdlp(
    [
      `https://www.youtube.com/watch?v=${videoId}`,
      "--dump-single-json",
      "--write-comments",
      "--skip-download",
      "--no-playlist",
      "--extractor-args",
      `youtube:comment_sort=top;max_comments=${maxComments},10,10,100`,
      ...COMMON_FLAGS,
      "--proxy",
      proxyUrl,
    ],
    timeoutMs,
  );
  if (r.code !== 0) {
    throw createYtdlpError(`comments fetch failed`, r);
  }
  const info = JSON.parse(r.stdout) as RawYtdlpInfoWithComments;
  return (info.comments ?? [])
    .filter((c) => c.text && c.text.trim().length > 0)
    .map((c) => ({
      text: (c.text ?? "").trim().slice(0, 400),
      author: c.author ?? null,
      likes: typeof c.like_count === "number" ? c.like_count : 0,
    }))
    .sort((a, b) => b.likes - a.likes);
}

type YtdlpErr = Error & { status?: number; stderr?: string };

function createYtdlpError(prefix: string, r: YtdlpResult): YtdlpErr {
  const stderr = r.stderr.slice(0, 400);
  const httpMatch = stderr.match(/HTTP Error (\d{3})/);
  const status = httpMatch ? Number(httpMatch[1]) : undefined;
  const err = new Error(`${prefix} exit=${r.code} stderr=${stderr}`) as YtdlpErr;
  err.status = status;
  err.stderr = stderr;
  return err;
}
