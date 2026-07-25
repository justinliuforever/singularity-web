import { spawn } from "node:child_process";
import { createWriteStream, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { recordUsage } from "../metering";
import { classifyError, ProxyPool, type ProxySession } from "../proxy";
import {
  downloadAudioWithYtdlp,
  ensureYtdlpBinary,
  getAutoCaptionsYtdlp,
} from "./ytdlp";

// Each extra language is a separate YouTube subtitle request; they 429 past ~3 langs per video.
const CAPTION_PREFER_LANGS = ["en", "zh-Hans"];

const CAPTION_MIN_CHARS = 80;

// Above this the audio file gets unwieldy and Deepgram billing unreasonable.
const MAX_AUDIO_DURATION_SEC = 3600;

const DOWNLOAD_TIMEOUT_MS = 900_000;

function extensionForMime(mime?: string): string {
  if (!mime) return "m4a";
  if (mime.includes("webm")) return "webm";
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("mpeg")) return "mp3";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("wav")) return "wav";
  return "m4a";
}

async function downloadOnce(url: string, ext: string): Promise<string> {
  const dest = join(
    tmpdir(),
    `goooose-asr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`,
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: controller.signal,
    });
    if (!res.ok || !res.body) throw new Error(`audio download HTTP ${res.status}`);
    // pipeline() vs pipe()+finished() so AbortError can't escape as unhandled 'error'
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(dest));
    return dest;
  } catch (err) {
    try {
      unlinkSync(dest);
    } catch {
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function downloadToTemp(
  url: string,
  ext: string,
  attempts = 2,
  logger?: { warn: (msg: string) => void },
): Promise<string> {
  let lastErr: Error | undefined;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await downloadOnce(url, ext);
    } catch (err) {
      lastErr = err as Error;
      if (attempt < attempts) {
        logger?.warn(
          `Download attempt ${attempt}/${attempts} failed (${lastErr.message?.slice(0, 80)}), retrying in ${attempt}s`,
        );
        await new Promise((r) => setTimeout(r, attempt * 1000));
      }
    }
  }
  throw lastErr ?? new Error("download failed after retries");
}

type DgWord = { word?: string; start?: number; end?: number };
type DgResponse = {
  metadata?: { duration?: number };
  results?: {
    channels?: Array<{
      alternatives?: Array<{ transcript?: string; words?: DgWord[] }>;
      detected_language?: string;
    }>;
  };
  err_code?: string;
  err_msg?: string;
};

async function transcribeWithDeepgram(
  bytes: Uint8Array,
  mime: string,
): Promise<{
  text: string;
  durationSec?: number;
  detectedLanguage?: string;
  words: Array<{ w: string; t: number }>;
} | null> {
  if (!process.env.DEEPGRAM_API_KEY) return null;
  const res = await fetch(
    "https://api.deepgram.com/v1/listen?model=nova-3&language=multi&smart_format=true&punctuate=true&utterances=true",
    {
      method: "POST",
      headers: {
        Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
        "Content-Type": mime,
      },
      body: bytes,
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Deepgram HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const dg = (await res.json()) as DgResponse;
  if (dg.err_code) throw new Error(`Deepgram ${dg.err_code}: ${dg.err_msg}`);
  const alt = dg.results?.channels?.[0]?.alternatives?.[0];
  const transcript = alt?.transcript?.trim() ?? "";
  if (!transcript) return null;
  const words = (alt?.words ?? [])
    .filter((w) => w.word && typeof w.start === "number")
    .map((w) => ({ w: (w.word ?? "").trim(), t: Math.floor(w.start ?? 0) }));
  return {
    text: transcript,
    durationSec: dg.metadata?.duration,
    detectedLanguage: dg.results?.channels?.[0]?.detected_language,
    words,
  };
}

export type AsrResult = {
  text: string;
  detectedLanguage?: string;
  durationSec?: number;
  provider: "deepgram" | "youtube_auto" | "qwen";
  words: Array<{ w: string; t: number }>;
};

// Drop ad/promo windows so the LLM doesn't score sponsor read-outs as hooks/CTAs.
const AD_CATEGORIES = new Set(["sponsor", "selfpromo"]);

export function stripAdSegments(
  words: Array<{ w: string; t: number }>,
  sponsorChapters: Array<{ start_time: number; end_time: number; category: string }>,
): Array<{ w: string; t: number }> {
  const ads = sponsorChapters.filter((c) => AD_CATEGORIES.has(c.category));
  if (ads.length === 0) return words;
  return words.filter(
    (w) => !ads.some((a) => w.t >= a.start_time && w.t < a.end_time),
  );
}

// [mm:ss] markers let the LLM cite moments; ~6s balances that against prompt length.
const TIMESTAMP_INTERVAL_SEC = 6;

export function renderTranscriptWithTimestamps(
  text: string,
  words: Array<{ w: string; t: number }>,
): string {
  if (words.length === 0) return text;
  const segments: string[] = [];
  let lastStamp = -TIMESTAMP_INTERVAL_SEC;
  let buffer: string[] = [];
  const flush = (t: number) => {
    if (buffer.length === 0) return;
    const mm = Math.floor(t / 60);
    const ss = t % 60;
    segments.push(`[${mm}:${ss.toString().padStart(2, "0")}] ${buffer.join(" ")}`);
    buffer = [];
  };
  for (const word of words) {
    if (word.t - lastStamp >= TIMESTAMP_INTERVAL_SEC) {
      flush(lastStamp >= 0 ? lastStamp : 0);
      lastStamp = word.t;
    }
    buffer.push(word.w);
  }
  flush(lastStamp >= 0 ? lastStamp : 0);
  return segments.join("\n");
}

export type AsrPhase = "selecting" | "downloading" | "transcribing";

// ≥4 Han chars in a title means the speech is almost certainly Mandarin, which Deepgram
// empties/garbles — routes to qwenFirst.
export function likelyChineseText(s: string | null | undefined): boolean {
  return ((s ?? "").match(/[一-鿿]/g)?.length ?? 0) >= 4;
}

// Below this rate Deepgram is almost certainly garbled (seen on CN+EN code-switching audio);
// real speech runs 5-15 chars/sec in both languages.
const MIN_CHARS_PER_SEC = 1;

export type StreamCandidate = {
  url: string;
  mimeType?: string;
  sizeHint?: number;
  label?: string;
  codec?: string;
};

export type TranscribeOpts = {
  onPhase?: (phase: AsrPhase, info?: { bytes?: number; provider?: string }) => void;
  logger?: { info: (msg: string) => void; warn: (msg: string) => void };
  durationSec?: number;
  tag?: string;
  // Deepgram returns empty/garbled Mandarin; it still runs as fallback when Qwen yields nothing.
  qwenFirst?: boolean;
  // Skip the h265-last/size sort: the caller's order is intentional (Douyin h265 carries audio).
  preserveOrder?: boolean;
};

// Qwen's body caps ~10MB and base64 inflates ~37%; XHS ships full h265 video (7-12MB), which
// 413s. A mono 16kHz clip is ~1MB. Null when ffmpeg is unavailable — caller uses the raw file.
async function extractAudioForQwen(
  srcPath: string,
  logger?: { warn: (msg: string) => void },
): Promise<string | null> {
  const out = join(
    tmpdir(),
    `goooose-asr-audio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.m4a`,
  );
  // FFMPEG_PATH: the Trigger build extension installs to /usr/bin/ffmpeg and spawned children
  // don't reliably inherit that PATH. AAC, not mp3 — the Debian image's ffmpeg has no libmp3lame.
  const bin = process.env.FFMPEG_PATH || "ffmpeg";
  return await new Promise((resolve) => {
    let stderr = "";
    const ff = spawn(
      bin,
      // +faststart moves the moov atom to the front — Qwen's m4a parser rejects it otherwise.
      ["-y", "-i", srcPath, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "aac", "-b:a", "48k", "-movflags", "+faststart", out],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    ff.stderr?.on("data", (d) => {
      if (stderr.length < 4000) stderr += d.toString();
    });
    ff.on("error", (e) => {
      logger?.warn(`ffmpeg spawn failed (bin=${bin}): ${(e as Error).message}`);
      resolve(null);
    });
    ff.on("close", (code) => {
      try {
        if (code === 0 && statSync(out).size > 0) return resolve(out);
      } catch {
      }
      if (code !== 0) logger?.warn(`ffmpeg exit ${code} (bin=${bin}): ${stderr.trim().slice(-240)}`);
      try {
        unlinkSync(out);
      } catch {
      }
      resolve(null);
    });
  });
}

// base64 inflates ~37%, plus JSON/data-URI overhead — keep the encoded body < ~10MB.
const QWEN_BODY_SAFE_BYTES = 7_300_000;

// qwen3-asr-flash rejects clips beyond ~3 minutes ("The audio is too long").
// At the 48kbps mono AAC we extract, ~170s ≈ 1.05MB — above that, segment and stitch.
const QWEN_CHUNK_SECONDS = 170;
const QWEN_SINGLE_SHOT_BYTES = 1_100_000;

async function segmentAudioForQwen(
  srcPath: string,
  logger?: { warn: (msg: string) => void },
): Promise<string[] | null> {
  const stem = join(
    tmpdir(),
    `goooose-asr-seg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  const bin = process.env.FFMPEG_PATH || "ffmpeg";
  return await new Promise((resolve) => {
    let stderr = "";
    const ff = spawn(
      bin,
      [
        "-y", "-i", srcPath, "-vn", "-c", "copy",
        "-f", "segment", "-segment_time", String(QWEN_CHUNK_SECONDS),
        "-reset_timestamps", "1",
        // Same reason as extractAudioForQwen: Qwen's m4a parser needs moov up front.
        "-segment_format_options", "movflags=+faststart",
        `${stem}-%03d.m4a`,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    ff.stderr?.on("data", (d) => {
      if (stderr.length < 4000) stderr += d.toString();
    });
    ff.on("error", (e) => {
      logger?.warn(`ffmpeg segment spawn failed (bin=${bin}): ${(e as Error).message}`);
      resolve(null);
    });
    ff.on("close", (code) => {
      const prefix = `${basename(stem)}-`;
      let files: string[] = [];
      try {
        files = readdirSync(tmpdir())
          .filter((f) => f.startsWith(prefix))
          .sort()
          .map((f) => join(tmpdir(), f));
      } catch {
      }
      if (code === 0 && files.length > 0) return resolve(files);
      logger?.warn(`ffmpeg segment exit ${code} (bin=${bin}): ${stderr.trim().slice(-240)}`);
      for (const f of files) {
        try {
          unlinkSync(f);
        } catch {
        }
      }
      resolve(null);
    });
  });
}

// Qwen3-ASR-Flash (Alibaba Model Studio, Singapore): OpenAI-compatible chat endpoint, base64
// audio. Pass language to force it (XHS -> "zh"); omit for auto-detect via enable_lid.
async function qwenRequest(
  sendPath: string,
  mediaType: string,
  language?: string,
): Promise<string | null> {
  const key = process.env.DASHSCOPE_API_KEY;
  const base = process.env.DASHSCOPE_ASR_BASE_URL;
  if (!key || !base) return null;
  const b64 = readFileSync(sendPath).toString("base64");
  const asrOptions: Record<string, unknown> = { enable_lid: true, enable_itn: false };
  if (language) asrOptions.language = language;
  const res = await fetch(`${base}/compatible-mode/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "qwen3-asr-flash",
      messages: [{ role: "user", content: [{ type: "input_audio", input_audio: { data: `data:${mediaType};base64,${b64}` } }] }],
      stream: false,
      asr_options: asrOptions,
    }),
  });
  if (!res.ok) {
    throw new Error(`Qwen ASR HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  }
  const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return (j.choices?.[0]?.message?.content ?? "").trim() || null;
}

// Exported for the asr-chunk smoke test only.
export async function transcribeWithQwen(
  tempPath: string,
  mime: string,
  language?: string,
  logger?: { warn: (msg: string) => void },
): Promise<{ text: string; detectedLanguage?: string; words: Array<{ w: string; t: number }> } | null> {
  if (!process.env.DASHSCOPE_API_KEY || !process.env.DASHSCOPE_ASR_BASE_URL) return null;

  const audioPath = await extractAudioForQwen(tempPath, logger);
  const sendPath = audioPath ?? tempPath;
  const mediaType = audioPath
    ? "audio/mp4"
    : /^(audio|video)\//.test(mime)
      ? mime
      : "audio/mp4";
  const cleanup: string[] = audioPath ? [audioPath] : [];
  try {
    const sendBytes = statSync(sendPath).size;
    // Chunking is gated on audioPath because only the extracted audio has a known bitrate;
    // the raw-file fallback keeps the byte cap instead.
    if (audioPath && sendBytes > QWEN_SINGLE_SHOT_BYTES) {
      const chunks = await segmentAudioForQwen(sendPath, logger);
      if (!chunks) {
        throw new Error(`audio ${sendBytes}B needs chunking but ffmpeg segmentation failed`);
      }
      cleanup.push(...chunks);
      const parts: string[] = [];
      let failures = 0;
      for (let i = 0; i < chunks.length; i++) {
        try {
          const t = await qwenRequest(chunks[i]!, "audio/mp4", language);
          if (t) parts.push(t);
          else failures++;
        } catch (err) {
          failures++;
          logger?.warn(
            `Qwen chunk ${i + 1}/${chunks.length} failed: ${(err as Error).message?.slice(0, 120)}`,
          );
        }
      }
      if (parts.length === 0) {
        throw new Error(`all ${chunks.length} Qwen chunks failed`);
      }
      if (failures > 0) {
        logger?.warn(`Qwen chunked: ${parts.length}/${chunks.length} segments transcribed`);
      }
      return { text: parts.join("\n"), words: [], detectedLanguage: language ?? "auto" };
    }

    if (sendBytes > QWEN_BODY_SAFE_BYTES) {
      throw new Error(
        `audio ${sendBytes}B over Qwen body-safe cap${audioPath ? " after extraction" : " (ffmpeg unavailable)"}`,
      );
    }
    const text = await qwenRequest(sendPath, mediaType, language);
    if (!text) return null;
    return { text, words: [], detectedLanguage: language ?? "auto" };
  } finally {
    for (const f of cleanup) {
      try {
        unlinkSync(f);
      } catch {
      }
    }
  }
}

async function transcribeAtPath(
  tempPath: string,
  mime: string,
  sizeBytes: number,
  opts: TranscribeOpts,
  preferQwen = false,
): Promise<AsrResult | null> {
  const { onPhase, logger, durationSec, tag = "ASR" } = opts;

  if (preferQwen) {
    // XHS / Chinese: Qwen only, forced zh — Deepgram returns gibberish on Chinese, so there is
    // no audio fallback; null makes the caller fall back to title-only text.
    onPhase?.("transcribing", { bytes: sizeBytes, provider: "qwen" });
    try {
      const qwen = await transcribeWithQwen(tempPath, mime, "zh", logger);
      if (qwen) {
        logger?.info(`${tag}: Qwen OK (${qwen.text.length} chars)`);
        return { ...qwen, provider: "qwen" };
      }
      logger?.warn(`${tag}: Qwen returned empty`);
    } catch (err) {
      logger?.warn(`${tag}: Qwen failed (${(err as Error).message?.slice(0, 160)})`);
    }
    return null;
  }

  // YouTube: Deepgram primary (it alone gives word timestamps), Qwen as fallback for Chinese
  // audio it empties/garbles; qwenFirst flips the order — the second one is still the safety net.
  const attemptDeepgram = async (): Promise<AsrResult | null> => {
    onPhase?.("transcribing", { bytes: sizeBytes, provider: "deepgram" });
    try {
      const bytes = readFileSync(tempPath);
      const dg = await transcribeWithDeepgram(bytes, mime);
      if (dg) {
        const effectiveDur = durationSec ?? dg.durationSec;
        const ratio = effectiveDur && effectiveDur > 0 ? dg.text.length / effectiveDur : Infinity;
        if (effectiveDur && effectiveDur > 30 && ratio < MIN_CHARS_PER_SEC) {
          logger?.warn(
            `${tag}: Deepgram returned ${dg.text.length} chars for ${effectiveDur}s audio (${ratio.toFixed(2)} chars/sec, likely garbled)`,
          );
        } else {
          logger?.info(`${tag}: Deepgram OK (${dg.text.length} chars, ${dg.words.length} words)`);
          return { ...dg, provider: "deepgram" };
        }
      } else {
        logger?.warn(`${tag}: Deepgram returned empty`);
      }
    } catch (err) {
      logger?.warn(`${tag}: Deepgram failed (${(err as Error).message?.slice(0, 120)})`);
    }
    return null;
  };
  const attemptQwen = async (): Promise<AsrResult | null> => {
    onPhase?.("transcribing", { bytes: sizeBytes, provider: "qwen" });
    try {
      const qwen = await transcribeWithQwen(tempPath, mime, undefined, logger);
      if (qwen) {
        logger?.info(`${tag}: Qwen OK (${qwen.text.length} chars)`);
        return { ...qwen, provider: "qwen" };
      }
      logger?.warn(`${tag}: Qwen returned empty`);
    } catch (err) {
      logger?.warn(`${tag}: Qwen failed (${(err as Error).message?.slice(0, 160)})`);
    }
    return null;
  };

  const order = opts.qwenFirst ? [attemptQwen, attemptDeepgram] : [attemptDeepgram, attemptQwen];
  for (const attempt of order) {
    const result = await attempt();
    if (result) return result;
  }
  return null;
}

// Pre-resolved CDN URLs, no proxy (rednotecdn unrestricted). XHS serves its h265 variants
// VIDEO-ONLY — the audio track lives in the h264 stream — so audio-bearing codecs go first and
// a stream that yields no transcript falls through to the next.
export async function transcribeFromStreams(
  streams: StreamCandidate[],
  opts: TranscribeOpts = {},
): Promise<AsrResult | null> {
  const { onPhase, logger, durationSec, tag = "ASR" } = opts;
  if (durationSec !== undefined && durationSec > MAX_AUDIO_DURATION_SEC) {
    logger?.warn(`${tag}: skipping audio ASR — duration ${durationSec}s > ${MAX_AUDIO_DURATION_SEC}s cap`);
    return null;
  }
  const isH265 = (s: StreamCandidate) => /h265|hevc/i.test(`${s.codec ?? ""} ${s.label ?? ""}`);
  const filtered = [...streams].filter((s) => s.url);
  const sorted = opts.preserveOrder
    ? filtered
    : filtered.sort(
        (a, b) =>
          Number(isH265(a)) - Number(isH265(b)) || (a.sizeHint ?? Infinity) - (b.sizeHint ?? Infinity),
      );
  if (sorted.length === 0) {
    logger?.warn(`${tag}: no streams with URLs`);
    return null;
  }

  for (let s = 0; s < sorted.length; s++) {
    const stream = sorted[s]!;
    let tempPath: string | null = null;
    try {
      onPhase?.("downloading");
      tempPath = await downloadToTemp(stream.url, extensionForMime(stream.mimeType), 2, logger);
      const actualSize = statSync(tempPath).size;
      logger?.info(
        `${tag}: downloaded ${actualSize} bytes${stream.label ? ` (${stream.label})` : ""}`,
      );
      const mime = (stream.mimeType ?? "audio/mp4").split(";")[0] ?? "audio/mp4";
      const result = await transcribeAtPath(tempPath, mime, actualSize, opts, true);
      if (result) {
        recordUsage({
          resourceType: "asr",
          provider: result.provider,
          audioSeconds: result.durationSec ?? durationSec ?? 0,
          apiCalls: 1,
        });
        return result;
      }
      logger?.warn(
        `${tag}: stream ${s + 1}/${sorted.length}${stream.label ? ` (${stream.label})` : ""} yielded no transcript${s + 1 < sorted.length ? ", trying next" : ""}`,
      );
    } catch (err) {
      logger?.warn(
        `${tag}: stream ${s + 1}/${sorted.length}${stream.label ? ` (${stream.label})` : ""} failed: ${(err as Error).message?.slice(0, 120)}`,
      );
    } finally {
      if (tempPath) {
        try {
          unlinkSync(tempPath);
        } catch {
        }
      }
    }
  }
  logger?.warn(`${tag}: all ${sorted.length} streams exhausted, no transcript`);
  return null;
}

async function transcribeYoutubeOnce(
  videoId: string,
  session: ProxySession,
  opts: TranscribeOpts,
): Promise<{ result: AsrResult | null; bytes: number }> {
  const { logger, tag = `ASR ${videoId}`, onPhase } = opts;
  await ensureYtdlpBinary();

  // Caption-first: ~50KB vs 5-10MB audio download.
  let captionBotCheck: Error | null = null;
  try {
    onPhase?.("selecting");
    const captions = await getAutoCaptionsYtdlp(
      videoId,
      CAPTION_PREFER_LANGS,
      session.url,
      60_000,
      logger,
    );
    if (captions && captions.text.length >= CAPTION_MIN_CHARS) {
      logger?.info(
        `${tag}: YouTube auto-captions OK (${captions.text.length} chars, ${captions.words.length} words, lang=${captions.lang})`,
      );
      return {
        result: {
          text: captions.text,
          detectedLanguage: captions.lang,
          provider: "youtube_auto",
          words: captions.words,
        },
        // Approx json3 file size: the proxy bills bytes-over-wire, not transcript length.
        bytes: 50_000,
      };
    }
    if (captions) {
      logger?.warn(
        `${tag}: auto-captions returned ${captions.text.length} chars < ${CAPTION_MIN_CHARS} floor — falling through to audio ASR`,
      );
    } else {
      logger?.info(`${tag}: no auto-captions found, falling through to audio ASR`);
    }
  } catch (err) {
    const status = (err as Error & { status?: number }).status;
    if (classifyError(err, status) === "bot_check") captionBotCheck = err as Error;
    logger?.warn(`${tag}: caption attempt threw: ${(err as Error).message?.slice(0, 120)}`);
  }

  if (opts.durationSec !== undefined && opts.durationSec > MAX_AUDIO_DURATION_SEC) {
    if (captionBotCheck) throw captionBotCheck;
    logger?.info(
      `${tag}: skipping audio ASR — duration ${opts.durationSec}s > ${MAX_AUDIO_DURATION_SEC}s cap`,
    );
    return { result: null, bytes: 0 };
  }

  const outPath = join(
    tmpdir(),
    `goooose-asr-${videoId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.m4a`,
  );
  onPhase?.("downloading");
  try {
    const r = await downloadAudioWithYtdlp({ videoId, outPath, proxyUrl: session.url });
    if (r.code !== 0) {
      const stderr = r.stderr.slice(0, 300);
      const httpMatch = stderr.match(/HTTP Error (\d{3})/);
      const status = httpMatch ? Number(httpMatch[1]) : undefined;
      const err = new Error(`yt-dlp exit=${r.code} stderr=${stderr}`);
      (err as Error & { status?: number }).status = status;
      throw err;
    }
    if (!statSync(outPath).isFile()) {
      throw new Error(`yt-dlp finished but no output file at ${outPath}`);
    }
    const size = statSync(outPath).size;
    logger?.info(`${tag}: downloaded ${size} bytes via ${session.provider} session`);
    const asr = await transcribeAtPath(outPath, "audio/mp4", size, opts);
    return { result: asr, bytes: size };
  } finally {
    try {
      unlinkSync(outPath);
    } catch {
    }
  }
}

// Each retry checks out a fresh pool session, which rotates the egress IP.
export async function transcribeYoutubeVideo(
  videoId: string,
  pool: ProxyPool,
  opts: TranscribeOpts = {},
  maxAttempts = 3,
): Promise<AsrResult | null> {
  let lastErr: Error | undefined;
  let excludeProvider: string | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let session: ProxySession;
    try {
      session = pool.checkout({ excludeProvider });
    } catch (err) {
      opts.logger?.warn(`ASR ${videoId}: pool exhausted on attempt ${attempt}`);
      throw err;
    }
    try {
      const { result, bytes } = await transcribeYoutubeOnce(videoId, session, opts);
      pool.reportOk(session, bytes);
      if (result) {
        recordUsage({
          resourceType: "asr",
          provider: result.provider,
          audioSeconds: result.durationSec ?? opts.durationSec ?? 0,
          apiCalls: 1,
        });
      }
      return result;
    } catch (err) {
      lastErr = err as Error;
      const status = (err as Error & { status?: number }).status;
      const kind = classifyError(err, status);
      pool.reportErr(session, lastErr.message, kind);
      opts.logger?.warn(
        `ASR ${videoId}: attempt ${attempt}/${maxAttempts} via ${session.provider} failed (${kind}) — ${lastErr.message?.slice(0, 120)}`,
      );
      if (kind === "consecutive_403" || kind === "auth_failed") {
        excludeProvider = undefined;
      }
    }
  }
  opts.logger?.warn(
    `ASR ${videoId}: all ${maxAttempts} attempts exhausted (last: ${lastErr?.message?.slice(0, 120)})`,
  );
  return null;
}
