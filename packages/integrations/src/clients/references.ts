import { classifyError, ProxyPool } from "../proxy";
import { type CaptionTrack } from "./tikhub";
import {
  renderTranscriptWithTimestamps,
  transcribeYoutubeVideo,
} from "./asr";
import { getVideoMetadataYtdlp } from "./ytdlp";
import { expandXhsShortLink, extractXhsNoteId, extractXsecToken, getXhsNoteDetail } from "./xhs";
import { getDouyinVideoDetail } from "./douyin";

export { extractXhsNoteId };

const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function extractYoutubeVideoId(url: string): string | null {
  const s = url.trim();
  if (YT_ID_RE.test(s)) return s;
  try {
    const parsed = new URL(s);
    const host = parsed.hostname.toLowerCase();
    if (host.includes("youtu.be")) {
      const id = parsed.pathname.replace(/^\//, "").slice(0, 11);
      if (YT_ID_RE.test(id)) return id;
    }
    if (host.includes("youtube.com")) {
      const cleanedPath = parsed.pathname.replace(/\/$/, "");
      if (cleanedPath === "/watch") {
        const v = parsed.searchParams.get("v") ?? "";
        if (YT_ID_RE.test(v)) return v;
      }
      const m = parsed.pathname.match(/\/(?:shorts|live|embed|v)\/([A-Za-z0-9_-]{11})/);
      if (m) return m[1]!;
    }
  } catch {
  }
  return null;
}

export type ReferenceInput = {
  kind: "youtube" | "xhs" | "douyin" | "text";
  url?: string;
  text?: string;
  title?: string;
};

export type FetchedReference = {
  type: string;
  url?: string;
  title: string;
  content: string;
  source?: string;
  error?: string;
  fetchedAt: string;
};

async function fetchYoutubeReference(
  ref: ReferenceInput,
  pool?: ProxyPool,
): Promise<FetchedReference> {
  const url = ref.url ?? "";
  const videoId = extractYoutubeVideoId(url);
  const fetchedAt = new Date().toISOString();
  if (!videoId) {
    return {
      type: "youtube",
      url,
      title: ref.title || "YouTube (unparseable URL)",
      content: "",
      error: `Could not extract YouTube video id from URL: ${url}`,
      fetchedAt,
    };
  }
  if (!pool) {
    return {
      type: "youtube",
      url,
      title: ref.title || `YouTube · ${videoId}`,
      content: "",
      error: "YouTube reference requires a proxy pool — caller did not provide one",
      fetchedAt,
    };
  }
  try {
    let info: Awaited<ReturnType<typeof getVideoMetadataYtdlp>> | null = null;
    const metaAttempts = 3;
    for (let attempt = 1; attempt <= metaAttempts; attempt++) {
      const metaSession = pool.checkout();
      try {
        info = await getVideoMetadataYtdlp(videoId, metaSession.url);
        pool.reportOk(metaSession, 10_000);
        break;
      } catch (err) {
        const kind = classifyError(err, (err as Error & { status?: number }).status);
        pool.reportErr(metaSession, (err as Error).message, kind);
        if (attempt < metaAttempts && (kind === "bot_check" || kind === "consecutive_403")) {
          continue;
        }
        break;
      }
    }
    const asr = await transcribeYoutubeVideo(videoId, pool, {
      durationSec: info?.duration_sec,
    });
    if (!asr) {
      return {
        type: "youtube",
        url,
        title: ref.title || info?.title || `YouTube · ${videoId}`,
        content: "",
        error: `No transcript available for ${videoId} (no captions, ASR failed)`,
        fetchedAt,
      };
    }
    const text = renderTranscriptWithTimestamps(asr.text, asr.words);
    const source = asr.provider === "youtube_auto" ? "caption" : "asr";
    return {
      type: "youtube",
      url,
      title: ref.title || info?.title || `YouTube · ${videoId}`,
      content: text,
      source,
      fetchedAt,
    };
  } catch (err) {
    return {
      type: "youtube",
      url,
      title: ref.title || `YouTube · ${videoId}`,
      content: "",
      error: (err as Error).message.slice(0, 200),
      fetchedAt,
    };
  }
}

async function fetchXhsReference(ref: ReferenceInput): Promise<FetchedReference> {
  const url = await expandXhsShortLink(ref.url ?? "");
  const noteId = extractXhsNoteId(url);
  const fetchedAt = new Date().toISOString();
  if (!noteId) {
    return {
      type: "xhs",
      url,
      title: ref.title || "XHS (unparseable URL)",
      content: "",
      error: `Could not extract XHS note id from URL: ${url}`,
      fetchedAt,
    };
  }
  try {
    const note = await getXhsNoteDetail(noteId, extractXsecToken(url));
    if (!note) {
      return {
        type: "xhs",
        url,
        title: ref.title || `XHS · ${noteId}`,
        content: "",
        error: `XHS note ${noteId} not found`,
        fetchedAt,
      };
    }
    const combined = [note.title, note.desc]
      .filter((s) => s.trim().length > 0)
      .join("\n\n")
      .trim();
    return {
      type: "xhs",
      url,
      title: ref.title || note.title || `XHS · ${noteId}`,
      content: combined,
      source: combined ? "text" : "none",
      fetchedAt,
    };
  } catch (err) {
    return {
      type: "xhs",
      url,
      title: ref.title || `XHS · ${noteId}`,
      content: "",
      error: (err as Error).message.slice(0, 200),
      fetchedAt,
    };
  }
}

// Douyin references take desc text only — no ASR (mirrors the XHS path).
export async function fetchDouyinReference(ref: ReferenceInput): Promise<FetchedReference> {
  const url = ref.url ?? "";
  const fetchedAt = new Date().toISOString();
  try {
    const video = await getDouyinVideoDetail(url);
    if (!video) {
      return {
        type: "douyin",
        url,
        title: ref.title || "Douyin (not found)",
        content: "",
        error: `Could not resolve Douyin video from: ${url}`,
        fetchedAt,
      };
    }
    const content = video.desc.trim();
    return {
      type: "douyin",
      url,
      title: ref.title || video.title || `Douyin · ${video.awemeId}`,
      content,
      source: content ? "text" : "none",
      fetchedAt,
    };
  } catch (err) {
    return {
      type: "douyin",
      url,
      title: ref.title || "Douyin",
      content: "",
      error: (err as Error).message.slice(0, 200),
      fetchedAt,
    };
  }
}

export async function fetchReference(
  ref: ReferenceInput,
  opts: { pool?: ProxyPool } = {},
): Promise<FetchedReference> {
  const fetchedAt = new Date().toISOString();
  if (ref.kind === "text") {
    return {
      type: "text",
      title: ref.title || "Pasted reference",
      content: ref.text ?? "",
      fetchedAt,
    };
  }
  if (ref.kind === "youtube") return fetchYoutubeReference(ref, opts.pool);
  if (ref.kind === "xhs") return fetchXhsReference(ref);
  if (ref.kind === "douyin") return fetchDouyinReference(ref);
  return {
    type: ref.kind,
    url: ref.url,
    title: ref.title || "Unknown reference",
    content: "",
    error: `Unknown reference kind: ${ref.kind}`,
    fetchedAt,
  };
}

export async function fetchReferences(
  refs: ReferenceInput[],
  opts: { pool?: ProxyPool } = {},
): Promise<FetchedReference[]> {
  const out: FetchedReference[] = [];
  for (const ref of refs) {
    out.push(await fetchReference(ref, opts));
  }
  return out;
}

export type { CaptionTrack };
