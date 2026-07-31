// Route mix is deliberate: profile on web/handler_user_profile ($0.001), posts / single-video /
// stats on the app/v3 series, comments on the web route.

import { recordUsage } from "../metering";
import { expandShortLink } from "../utils";
import { DOUYIN_SEC_UID_RE, findDouyinShortLink, isValidDouyinProfileUrl } from "../validators";

export { findDouyinShortLink, isValidDouyinProfileUrl };

const BASE = "https://api.tikhub.io";

const DOUYIN_SEC_UID_SCAN_RE = /MS4wLjABAAAA[A-Za-z0-9_-]{43,64}/;
const DOUYIN_AWEME_ID_RE = /^\d{15,21}$/;
const DOUYIN_AWEME_URL_RE = /\/video\/(\d{15,21})/;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function key(): string {
  const k = process.env.TIKHUB_API_KEY;
  if (!k) throw new Error("TIKHUB_API_KEY not set in env");
  return k;
}

// Deterministic business errors (bad id → data.status_code) must not be retried; transient
// shapes (network, 5xx, upstream RetryError body) should be.
export class TikHubError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "TikHubError";
    this.retryable = retryable;
  }
}

type RawEnvelope = {
  code?: number;
  error?: string;
  data?: ({ status_code?: number; status_msg?: string } & Record<string, unknown>) | unknown;
};

// Invalid ids still return HTTP 200 and bill, so three failure shapes ride over 200: a bare
// upstream exception body {"error":...} (transient), a non-200 top-level code, and a business
// error under data.status_code (deterministic). Degenerate-but-successful shapes (user:{},
// comments:null, aweme_detail missing) are left for callers to map to null/empty.
function assertEnvelopeOk(json: RawEnvelope, endpoint: string): void {
  if (typeof json.error === "string" && json.code === undefined) {
    throw new Error(`TikHub ${endpoint}: ${json.error.slice(0, 160)}`);
  }
  if (typeof json.code === "number" && json.code !== 200 && json.code !== 0) {
    throw new Error(`TikHub ${endpoint} code ${json.code}`);
  }
}

function assertBusinessOk(json: RawEnvelope, endpoint: string): void {
  const data = json.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const d = data as { status_code?: number; status_msg?: string };
    if (typeof d.status_code === "number" && d.status_code !== 0) {
      throw new TikHubError(`TikHub ${endpoint} status ${d.status_code}: ${d.status_msg ?? "unknown"}`, false);
    }
  }
}

// Full jitter over an exponential ceiling. The 2026-07-30 flap outlasted the old fixed
// 4 × 1500ms·i budget, and identical sleeps make concurrent callers re-hit a flapping
// origin in lockstep.
function backoffMs(attempt: number): number {
  return 500 + Math.floor(Math.random() * Math.min(1500 * 2 ** (attempt - 1), 15_000));
}

// Attempts alone can't bound wall clock once each one may burn the 30s timeout, and this
// client is awaited inline by web request paths too. Worst case is now budget + one attempt.
const RETRY_BUDGET_MS = 60_000;

// 30s hard timeout: a stalled TikHub origin would otherwise hang the run (xhs.ts/tikhub.ts have none).
async function get<T>(endpoint: string, params: Record<string, string>, attempts = 4): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const url = `${BASE}${endpoint}${qs ? `?${qs}` : ""}`;
  const deadline = Date.now() + RETRY_BUDGET_MS;
  const canRetry = (i: number) => i < attempts && Date.now() < deadline;
  let lastErr: Error | undefined;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${key()}`,
          accept: "application/json",
          "User-Agent": "Mozilla/5.0",
        },
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status >= 500 || res.status === 429 || res.status === 400) {
        const body = await res.text();
        lastErr = new Error(`TikHub ${endpoint} HTTP ${res.status}: ${body.slice(0, 300)}`);
        if (canRetry(i)) {
          // retry-after is capped and jittered too: an unbounded honour of it would park a
          // web request for minutes, and an exact honour re-synchronises every caller.
          const retryAfter = Number(res.headers.get("retry-after"));
          const waitMs =
            res.status === 429 && retryAfter > 0
              ? Math.min(retryAfter * 1000, 30_000) + Math.floor(Math.random() * 500)
              : backoffMs(i);
          await sleep(waitMs);
          continue;
        }
        throw lastErr;
      }
      if (!res.ok) {
        const body = await res.text();
        throw new TikHubError(`TikHub ${endpoint} HTTP ${res.status}: ${body.slice(0, 200)}`, false);
      }
      const json = (await res.json()) as RawEnvelope;
      assertEnvelopeOk(json, endpoint);
      // Business errors (status_code!=0) are still billed by TikHub — meter before throwing.
      recordUsage({ resourceType: "scrape", provider: "tikhub", model: endpoint, apiCalls: 1 });
      assertBusinessOk(json, endpoint);
      return json as T;
    } catch (err) {
      if (err instanceof TikHubError && !err.retryable) throw err;
      lastErr = err as Error;
      if (!canRetry(i)) throw lastErr;
      await sleep(backoffMs(i));
    }
  }
  throw lastErr ?? new Error(`TikHub ${endpoint} unreachable`);
}

export type DouyinUser = {
  secUserId: string;
  uid: string | null;
  uniqueId: string | null;
  nickname: string;
  avatarUrl: string | null;
  signature: string | null;
  followerCount: number | null;
  awemeCount: number | null;
  ipLocation: string | null;
  verifyInfo: string | null;
};

export type DouyinImage = { url: string; width: number; height: number };

export type DouyinVideoStats = {
  diggCount: number;
  commentCount: number;
  shareCount: number;
  collectCount: number;
  playCount: number | null;
};

export type DouyinVideo = {
  awemeId: string;
  desc: string;
  title: string;
  createTime: number;
  isTop: boolean;
  contentType: "douyin_video" | "douyin_image";
  durationSec: number | null;
  coverUrl: string | null;
  images: DouyinImage[];
  stats: DouyinVideoStats;
  engagementScore: number;
  videoUrl: string;
  authorSecUserId: string | null;
  authorNickname: string | null;
};

export type DouyinPlaySource = {
  playUrls: string[];
  lowestBitratePlayUrls: string[];
  originalSoundUrl: string | null;
  cdnUrlExpiresAt: number | null;
};

// Canonical ASR candidate order: original-sound MP3 (cheapest, pure audio), then low-bitrate
// video, then main play_addr. Shared by both worker pipelines so the tiers can't drift apart.
export function buildDouyinAsrStreams(
  play: DouyinPlaySource,
): Array<{ url: string; mimeType: string; label: string }> {
  return [
    ...(play.originalSoundUrl
      ? [{ url: play.originalSoundUrl, mimeType: "audio/mpeg", label: "original-sound" }]
      : []),
    ...play.lowestBitratePlayUrls
      .slice(0, 2)
      .map((url) => ({ url, mimeType: "video/mp4", label: "lowest-bitrate" })),
    ...play.playUrls.slice(0, 1).map((url) => ({ url, mimeType: "video/mp4", label: "play-addr" })),
  ];
}

export function computeDouyinEngagement(s: DouyinVideoStats): number {
  return s.diggCount + s.collectCount * 2 + s.commentCount * 3 + s.shareCount * 5;
}

export function buildDouyinVideoUrl(awemeId: string): string {
  return `https://www.douyin.com/video/${awemeId}`;
}

export function extractDouyinSecUserId(input: string): string | null {
  const s = input.trim();
  if (DOUYIN_SEC_UID_RE.test(s)) return s;
  // Share cards / profile URLs both carry the sec_uid verbatim as a path segment.
  return s.match(DOUYIN_SEC_UID_SCAN_RE)?.[0] ?? null;
}

export function extractDouyinAwemeId(input: string): string | null {
  const s = input.trim();
  if (DOUYIN_AWEME_ID_RE.test(s)) return s;
  // Matches douyin.com/video/<id> and iesdouyin.com/share/video/<id>, wrapped or not.
  return s.match(DOUYIN_AWEME_URL_RE)?.[1] ?? null;
}

export async function expandDouyinShortLink(input: string): Promise<string> {
  return expandShortLink(input, findDouyinShortLink(input));
}

type RawUrlContainer = { url_list?: unknown };
type RawAuthor = { sec_uid?: string; nickname?: string };
type RawStatistics = {
  digg_count?: number;
  comment_count?: number;
  share_count?: number;
  collect_count?: number;
  play_count?: number;
};
type RawBitRate = { bit_rate?: number; play_addr?: RawUrlContainer };
type RawVideo = {
  duration?: number;
  cover?: RawUrlContainer;
  play_addr?: RawUrlContainer;
  bit_rate?: RawBitRate[];
  cdn_url_expired?: number;
};
type RawMusic = { title?: string; duration?: number; play_url?: RawUrlContainer };
type RawImageItem = { url_list?: unknown; width?: number; height?: number };
type RawAweme = {
  aweme_id?: string;
  desc?: string;
  create_time?: number;
  is_top?: number;
  media_type?: number;
  aweme_type?: number;
  duration?: number;
  video?: RawVideo;
  images?: RawImageItem[];
  statistics?: RawStatistics;
  music?: RawMusic;
  author?: RawAuthor;
};

function urlList(c: RawUrlContainer | undefined): string[] {
  const raw = c?.url_list;
  if (!Array.isArray(raw)) return [];
  return raw.filter((u): u is string => typeof u === "string" && u.length > 0);
}

function pathOf(url: string): string {
  const q = url.indexOf("?");
  return (q === -1 ? url : url.slice(0, q)).toLowerCase();
}

// url_list holds .heic/.webp/.jpeg variants of the same asset and the signature is bound to the
// full path — rewriting a suffix onto a signed URL 403s, so pick an entry that is already jpeg.
function pickJpegUrl(c: RawUrlContainer | undefined): string | null {
  const list = urlList(c);
  if (!list.length) return null;
  const jpeg = list.find((u) => pathOf(u).endsWith(".jpeg"));
  if (jpeg) return jpeg;
  const webp = list.find((u) => pathOf(u).endsWith(".webp"));
  if (webp) return webp;
  const other = list.find((u) => {
    const p = pathOf(u);
    return !p.endsWith(".heic") && !p.endsWith(".heif") && !p.endsWith(".image");
  });
  return other ?? null;
}

function normalizeVideo(raw: RawAweme): DouyinVideo {
  const awemeId = String(raw.aweme_id ?? "");
  // media_type 2 = image post; aweme_type 68 backstops items where media_type is absent.
  const contentType =
    raw.media_type === 2 || raw.aweme_type === 68 ? "douyin_image" : "douyin_video";
  const desc = String(raw.desc ?? "");
  const durationMs = Number(raw.video?.duration ?? raw.duration ?? 0);
  const durationSec =
    contentType === "douyin_image" || !durationMs ? null : Math.round(durationMs / 1000);

  const stats: DouyinVideoStats = {
    diggCount: Number(raw.statistics?.digg_count ?? 0),
    commentCount: Number(raw.statistics?.comment_count ?? 0),
    shareCount: Number(raw.statistics?.share_count ?? 0),
    collectCount: Number(raw.statistics?.collect_count ?? 0),
    // List/detail endpoints always report 0 here; real plays only come from getDouyinVideoStats.
    playCount: null,
  };

  const images: DouyinImage[] = (raw.images ?? [])
    .map((img) => {
      const url = pickJpegUrl(img);
      return url ? { url, width: Number(img.width ?? 0), height: Number(img.height ?? 0) } : null;
    })
    .filter((x): x is DouyinImage => x !== null);

  return {
    awemeId,
    desc,
    title: desc.trim().slice(0, 80),
    createTime: Number(raw.create_time ?? 0),
    isTop: raw.is_top === 1,
    contentType,
    durationSec,
    coverUrl: pickJpegUrl(raw.video?.cover),
    images,
    stats,
    engagementScore: computeDouyinEngagement(stats),
    videoUrl: buildDouyinVideoUrl(awemeId),
    authorSecUserId: raw.author?.sec_uid ?? null,
    authorNickname: raw.author?.nickname ?? null,
  };
}

// A creator's "原声" is the only music safe to feed ASR: hot BGM is a 15-60s looped song, not speech.
function pickOriginalSound(music: RawMusic | undefined, videoDurationSec: number): string | null {
  if (!music) return null;
  const url = urlList(music.play_url)[0];
  if (!url) return null;
  if (!(music.title ?? "").includes("原声")) return null;
  if (typeof music.duration !== "number") return null;
  if (Math.abs(music.duration - videoDurationSec) > 2) return null;
  return url;
}

function extractPlaySource(raw: RawAweme): DouyinPlaySource {
  const video = raw.video ?? {};
  const playUrls = urlList(video.play_addr);
  const bitRates = [...(video.bit_rate ?? [])].sort((a, b) => (a.bit_rate ?? 0) - (b.bit_rate ?? 0));
  const lowest = urlList(bitRates[0]?.play_addr);
  const durationMs = Number(video.duration ?? raw.duration ?? 0);
  return {
    playUrls,
    lowestBitratePlayUrls: lowest.length ? lowest : playUrls,
    originalSoundUrl: pickOriginalSound(raw.music, durationMs / 1000),
    cdnUrlExpiresAt: typeof video.cdn_url_expired === "number" ? video.cdn_url_expired : null,
  };
}

type RawProfileResp = { data?: { user?: Record<string, unknown> } };

export async function resolveDouyinUser(profileUrlOrId: string): Promise<DouyinUser> {
  const expanded = await expandDouyinShortLink(profileUrlOrId);
  const secUserId = extractDouyinSecUserId(expanded);
  if (!secUserId) throw new Error(`Could not extract Douyin sec_user_id from: ${expanded}`);

  const j = await get<RawProfileResp>("/api/v1/douyin/web/handler_user_profile", {
    sec_user_id: secUserId,
  });
  const u = j.data?.user;
  if (!u || !u.sec_uid) throw new Error(`Douyin user not found: ${secUserId}`);

  const avatar =
    pickJpegUrl(u.avatar_larger as RawUrlContainer) ??
    pickJpegUrl(u.avatar_medium as RawUrlContainer) ??
    urlList(u.avatar_larger as RawUrlContainer)[0] ??
    null;
  const verify = String(u.enterprise_verify_reason ?? "").trim();

  return {
    secUserId: String(u.sec_uid),
    uid: u.uid != null ? String(u.uid) : null,
    uniqueId: u.unique_id ? String(u.unique_id) : null,
    nickname: String(u.nickname ?? ""),
    avatarUrl: avatar,
    signature: u.signature ? String(u.signature) : null,
    followerCount: typeof u.follower_count === "number" ? u.follower_count : null,
    awemeCount: typeof u.aweme_count === "number" ? u.aweme_count : null,
    ipLocation: u.ip_location ? String(u.ip_location) : null,
    verifyInfo: verify.length ? verify : null,
  };
}

type RawPostListResp = {
  data?: { aweme_list?: RawAweme[] | null; has_more?: number; max_cursor?: number };
};

// count=20 makes TikHub truncate the response body mid-JSON (HTTP 200, then the socket closes —
// undici raises "TypeError: terminated"). Measured 2026-07-31 over three accounts: count=20 lost
// 3/9 bodies and, in a bad window, 9/9; count=10 was clean 12/12 while returning a LARGER body,
// so this is not a size limit and retrying does not clear it — the failures cluster in time.
const PAGE_COUNT = 10;

// `partial` is returned rather than logged because callers rank and filter over this list —
// a silently truncated pool would sort "by engagement" across a fraction of the account.
export async function getDouyinUserVideos(
  secUserId: string,
  limit = 20,
): Promise<{ videos: DouyinVideo[]; partial: boolean }> {
  const id = extractDouyinSecUserId(secUserId) ?? secUserId.trim();
  const out: DouyinVideo[] = [];
  let cursor = 0;
  let partial = false;
  const maxPages = 10;
  for (let page = 0; page < maxPages && out.length < limit; page++) {
    // app_v3 (not web): the web post list lags active accounts by ~6 days.
    // Pinned items (is_top=1) ride the first page and don't count against `count`.
    // Page 0 gets the wider budget — it is the only page whose loss leaves nothing to return.
    const j = await get<RawPostListResp>(
      "/api/v1/douyin/app/v3/fetch_user_post_videos",
      { sec_user_id: id, count: String(PAGE_COUNT), max_cursor: String(cursor) },
      page === 0 ? 6 : 4,
    ).catch((err: Error) => {
      if (out.length === 0) throw err;
      partial = true;
      return null;
    });
    if (!j) break;
    const list = j.data?.aweme_list ?? [];
    for (const raw of list) out.push(normalizeVideo(raw));
    if (j.data?.has_more !== 1) break;
    cursor = Number(j.data?.max_cursor ?? 0);
    if (!cursor) break;
  }
  // Pinned lead, newest-first after; slicing the tail keeps pinned + latest.
  return { videos: out.slice(0, limit), partial };
}

type RawDetailResp = { data?: { aweme_detail?: RawAweme } };

async function fetchDetail(
  endpoint: string,
  params: Record<string, string>,
): Promise<(DouyinVideo & { play: DouyinPlaySource }) | null> {
  const j = await get<RawDetailResp>(endpoint, params);
  const det = j.data?.aweme_detail;
  if (!det) return null;
  return { ...normalizeVideo(det), play: extractPlaySource(det) };
}

export async function getDouyinVideoDetail(
  awemeIdOrUrl: string,
): Promise<(DouyinVideo & { play: DouyinPlaySource }) | null> {
  const input = awemeIdOrUrl.trim();
  let awemeId = extractDouyinAwemeId(input);
  if (!awemeId && findDouyinShortLink(input)) {
    const expanded = await expandDouyinShortLink(input);
    awemeId = extractDouyinAwemeId(expanded);
    // Short link that still won't yield an id → the share-url endpoint eats it directly.
    if (!awemeId) return fetchDetail("/api/v1/douyin/app/v3/fetch_one_video_by_share_url", { share_url: expanded });
  }
  if (!awemeId) {
    if (/^https?:\/\//i.test(input)) {
      return fetchDetail("/api/v1/douyin/app/v3/fetch_one_video_by_share_url", { share_url: input });
    }
    return null;
  }
  return fetchDetail("/api/v1/douyin/app/v3/fetch_one_video", { aweme_id: awemeId });
}

type RawStat = {
  aweme_id?: string;
  digg_count?: number;
  comment_count?: number;
  share_count?: number;
  collect_count?: number;
  play_count?: number;
};
type RawStatsResp = { data?: { statistics_list?: RawStat[] } };

export async function getDouyinVideoStats(
  awemeIds: string[],
): Promise<Record<string, Partial<DouyinVideoStats>>> {
  const ids = awemeIds.map((s) => s.trim()).filter(Boolean);
  if (!ids.length) return {};
  // Single-id route bills $0.001 vs $0.025 for the multi route; both take aweme_ids.
  const endpoint =
    ids.length > 1
      ? "/api/v1/douyin/app/v3/fetch_multi_video_statistics"
      : "/api/v1/douyin/app/v3/fetch_video_statistics";
  const j = await get<RawStatsResp>(endpoint, { aweme_ids: ids.join(",") });
  const out: Record<string, Partial<DouyinVideoStats>> = {};
  for (const s of j.data?.statistics_list ?? []) {
    if (!s.aweme_id) continue;
    // "Has a value → carries the key" is not a stable schema; map each field only when present.
    const partial: Partial<DouyinVideoStats> = {};
    if (typeof s.digg_count === "number") partial.diggCount = s.digg_count;
    if (typeof s.comment_count === "number") partial.commentCount = s.comment_count;
    if (typeof s.share_count === "number") partial.shareCount = s.share_count;
    if (typeof s.collect_count === "number") partial.collectCount = s.collect_count;
    if (typeof s.play_count === "number") partial.playCount = s.play_count;
    out[String(s.aweme_id)] = partial;
  }
  return out;
}

type RawComment = { text?: string; digg_count?: number; reply_comment_total?: number };
type RawCommentsResp = {
  data?: { comments?: RawComment[] | null; has_more?: number; cursor?: number };
};

export async function getDouyinTopComments(
  awemeId: string,
  limit = 20,
): Promise<Array<{ text: string; diggCount: number; replyCount: number }>> {
  const id = extractDouyinAwemeId(awemeId) ?? awemeId.trim();
  const collected: Array<{ text: string; diggCount: number; replyCount: number }> = [];
  let cursor = 0;
  const maxPages = 5; // count=100 yields ~45-55 after server-side filtering; fuse the loop.
  for (let page = 0; page < maxPages && collected.length < limit; page++) {
    const j = await get<RawCommentsResp>("/api/v1/douyin/web/fetch_video_comments", {
      aweme_id: id,
      count: "100",
      cursor: String(cursor),
    });
    for (const c of j.data?.comments ?? []) {
      const text = (c.text ?? "").trim();
      if (!text) continue; // sticker/image comments (content_type 2/3) carry empty text
      collected.push({
        text,
        diggCount: Number(c.digg_count ?? 0),
        replyCount: Number(c.reply_comment_total ?? 0),
      });
    }
    if (j.data?.has_more !== 1) break;
    cursor = Number(j.data?.cursor ?? cursor + 100);
  }
  // No server-side sort-by-likes param — rank client-side.
  collected.sort((a, b) => b.diggCount - a.diggCount);
  return collected.slice(0, limit);
}
