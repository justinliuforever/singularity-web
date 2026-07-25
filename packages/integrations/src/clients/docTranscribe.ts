// Faithful-markdown transcription for bible import; the page thresholds below are bake-off
// verified (2026-07), including digital-PDF single call at ≤15pp.

import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, wrapLanguageModel } from "ai";
import { unzipSync } from "fflate";
import mammoth from "mammoth";
import { PDFDocument } from "pdf-lib";
import { extractText, getDocumentProxy } from "unpdf";

import { usageMiddleware } from "../metering";

let _anthropic: ReturnType<typeof createAnthropic> | null = null;

function getAnthropic() {
  if (!_anthropic) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set in env");
    _anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _anthropic;
}

function model() {
  return wrapLanguageModel({
    model: getAnthropic()("claude-sonnet-4-6"),
    middleware: usageMiddleware("vision", "anthropic", "claude-sonnet-4-6"),
  });
}

export const ILLEGIBLE_MARK = "[无法辨识]";
export const DECORATIVE_MARK = "[装饰性图片，跳过]";

const VERBATIM_INSTRUCTION = `你是文档转写员。把下面的文档内容逐字转写为 Markdown：
- 表格用 Markdown 表格；合并单元格拆开重复填写；层级列表保留缩进
- 每一个数字、姓名、百分比、坐标、剂量、专有名词必须一字不改地保留，禁止四舍五入、禁止改写、禁止翻译
- 不要总结、不要补充任何原文没有的内容、不要解释
- 看不清或无法辨识的地方写 ${ILLEGIBLE_MARK}，禁止猜测
- 纯装饰性图片（logo、背景）写 ${DECORATIVE_MARK}`;

export type TranscribeResult = { text: string; finishReason: string };

// PDF text layers (font subsetting) can carry CJK radical codepoints (⻣⽪⼸) that render like the
// real ideographs (骨皮弓) but break every downstream string match (drift bigrams, name scrub,
// copy-paste). NFKC maps most; U+2E80-block ones without a mapping need the explicit table.
const RADICAL_FIXES: Record<string, string> = { "⻛": "风", "⻣": "骨", "⻥": "鱼", "⻓": "长", "⻆": "角", "⻘": "青" };
export function normalizeCjkCompat(text: string): string {
  return text
    .replace(/[⺀-⻳⼀-⿕]/g, (c) => RADICAL_FIXES[c] ?? c.normalize("NFKC"))
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

type Logger = { warn?: (m: string) => void; info?: (m: string) => void };

export async function transcribePdf(
  pdfBytes: Uint8Array,
  opts: { pageCount: number; pageStart?: number; logger?: Logger },
): Promise<TranscribeResult | null> {
  const start = opts.pageStart ?? 1;
  const scope =
    start === 1
      ? `转写整份 PDF（共 ${opts.pageCount} 页），每页开头输出一行 --- PAGE n ---。`
      : `这份 PDF 是原文档的第 ${start}-${start + opts.pageCount - 1} 页。转写全部内容，每页开头输出一行 --- PAGE n ---（n 为原文档页码，从 ${start} 开始）。`;
  try {
    const r = await generateText({
      model: model(),
      maxOutputTokens: 32000,
      temperature: 0,
      maxRetries: 2,
      messages: [
        {
          role: "user",
          content: [
            { type: "file", data: pdfBytes, mediaType: "application/pdf" },
            { type: "text", text: `${VERBATIM_INSTRUCTION}\n\n${scope}` },
          ],
        },
      ],
    });
    return { text: normalizeCjkCompat(r.text.trim()), finishReason: r.finishReason ?? "unknown" };
  } catch (err) {
    opts.logger?.warn?.(`transcribePdf failed: ${(err as Error).message?.slice(0, 200)}`);
    return null;
  }
}

const PDF_VERIFY_CHARS = 30_000;

// Numbers-only second look for scanned PDFs (no text layer to cross-check against).
// Reports how much it actually covered: a silent [] would be indistinguishable from a clean pass.
export async function verifyPdfNumbers(
  pdfBytes: Uint8Array,
  transcript: string,
  logger?: Logger,
): Promise<{ diffs: string[]; checked: "full" | "partial" | "failed" }> {
  const checked = transcript.length > PDF_VERIFY_CHARS ? "partial" : "full";
  try {
    const r = await generateText({
      model: model(),
      maxOutputTokens: 2000,
      temperature: 0,
      maxRetries: 2,
      messages: [
        {
          role: "user",
          content: [
            { type: "file", data: pdfBytes, mediaType: "application/pdf" },
            {
              type: "text",
              text: `下面是这份 PDF 的一份转写。只核对数字（金额、年份、坐标、剂量、百分比、数量）：逐一对照原文，列出转写中与原文不一致或原文中不存在的数字，每行一个，格式「转写值 -> 原文实际值」（原文中不存在则写「转写值 -> 无」）。全部一致则只输出 OK。\n\n## 转写\n${transcript.slice(0, PDF_VERIFY_CHARS)}`,
            },
          ],
        },
      ],
    });
    const out = r.text.trim();
    if (!out || out === "OK") return { diffs: [], checked };
    return {
      diffs: out
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && l !== "OK"),
      checked,
    };
  } catch (err) {
    logger?.warn?.(`verifyPdfNumbers failed: ${(err as Error).message?.slice(0, 120)}`);
    return { diffs: [], checked: "failed" };
  }
}

export async function transcribeImage(
  imageBytes: Uint8Array,
  opts?: { hint?: string; logger?: Logger },
): Promise<TranscribeResult | null> {
  try {
    const r = await generateText({
      model: model(),
      maxOutputTokens: 16000,
      temperature: 0,
      maxRetries: 2,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", image: imageBytes },
            {
              type: "text",
              text: `${VERBATIM_INSTRUCTION}\n\n转写这张图片里的全部内容${opts?.hint ? `（${opts.hint}）` : ""}。`,
            },
          ],
        },
      ],
    });
    return { text: normalizeCjkCompat(r.text.trim()), finishReason: r.finishReason ?? "unknown" };
  } catch (err) {
    opts?.logger?.warn?.(`transcribeImage failed: ${(err as Error).message?.slice(0, 200)}`);
    return null;
  }
}

// Vision hallucinates plausible digits, and images have no text layer to cross-check against.
export async function verifyImageNumbers(
  imageBytes: Uint8Array,
  transcript: string,
  logger?: Logger,
): Promise<{ diffs: string[]; ok: boolean }> {
  try {
    const r = await generateText({
      model: model(),
      maxOutputTokens: 2000,
      temperature: 0,
      maxRetries: 2,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", image: imageBytes },
            {
              type: "text",
              text: `下面是这张图片的一份转写。只核对数字（金额、年份、坐标、剂量、百分比、数量）：逐一对照图片，列出转写中与图片不一致或图片中不存在的数字，每行一个，格式「转写值 -> 图片实际值」（图片中不存在则写「转写值 -> 无」）。全部一致则只输出 OK。\n\n## 转写\n${transcript}`,
            },
          ],
        },
      ],
    });
    const out = r.text.trim();
    if (!out || out === "OK") return { diffs: [], ok: true };
    return {
      diffs: out
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && l !== "OK"),
      ok: true,
    };
  } catch (err) {
    logger?.warn?.(`verifyImageNumbers failed: ${(err as Error).message?.slice(0, 120)}`);
    return { diffs: [], ok: false };
  }
}

// "audit" means the offending lines were removed; "audit_source" means the suspect numbers are
// still in the bible — the two must stay distinct or the review card tells the user the wrong thing.
export type ImportFlag = {
  type: "illegible" | "truncated" | "audit" | "audit_source" | "image_failed";
  detail: string;
  context?: string;
  resolved?: boolean;
};

export type ImportProgress = { current: number; total: number; phase: string; detail: string };

export const SUPPORTED_MIMES: Record<string, "md" | "pdf" | "docx"> = {
  "text/markdown": "md",
  "text/plain": "md",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

const MAX_PDF_PAGES = 40;
const SINGLE_CALL_PAGES = 15;
const CHUNK_PAGES = 8;
const MAX_DOCX_IMAGES = 60;
const MAX_DOCX_VERIFY = 20;

const digitTokens = (s: string) => new Set(s.match(/\d+(?:\.\d+)?/g) ?? []);

function flagIllegible(transcript: string, flags: ImportFlag[]) {
  const count = transcript.split(ILLEGIBLE_MARK).length - 1;
  if (count > 0) {
    flags.push({
      type: "illegible",
      detail: `转写中有 ${count} 处「无法辨识」（模糊或被裁切的内容），请对照原文件核对`,
    });
  }
}

async function runPool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}

export type TranscribeDocumentResult = {
  transcript: string;
  flags: ImportFlag[];
  pagesTotal: number;
  imagesTotal: number;
};

export async function transcribeDocument(args: {
  bytes: Uint8Array;
  mime: string;
  onProgress?: (p: ImportProgress) => void | Promise<void>;
  logger?: Logger;
}): Promise<TranscribeDocumentResult> {
  const kind = SUPPORTED_MIMES[args.mime];
  if (!kind) throw new Error(`不支持的文件类型: ${args.mime}`);
  const flags: ImportFlag[] = [];

  if (kind === "md") {
    const transcript = normalizeCjkCompat(new TextDecoder("utf-8").decode(args.bytes).trim());
    return { transcript, flags, pagesTotal: 0, imagesTotal: 0 };
  }

  if (kind === "pdf") {
    const transcript = await transcribePdfDocument(args.bytes, flags, args.onProgress, args.logger);
    flagIllegible(transcript, flags);
    const pdf = await PDFDocument.load(args.bytes, { ignoreEncryption: true });
    return { transcript, flags, pagesTotal: pdf.getPageCount(), imagesTotal: 0 };
  }

  const { transcript, imagesTotal } = await transcribeDocx(args.bytes, flags, args.onProgress, args.logger);
  flagIllegible(transcript, flags);
  return { transcript, flags, pagesTotal: 0, imagesTotal };
}

async function transcribePdfDocument(
  bytes: Uint8Array,
  flags: ImportFlag[],
  onProgress?: (p: ImportProgress) => void | Promise<void>,
  logger?: Logger,
): Promise<string> {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  let pageCount = src.getPageCount();
  if (pageCount > MAX_PDF_PAGES) {
    flags.push({ type: "truncated", detail: `文档共 ${pageCount} 页，仅转写前 ${MAX_PDF_PAGES} 页` });
    pageCount = MAX_PDF_PAGES;
  }

  // Text layer = free ground truth for digits (digital PDFs); ~absent on scans.
  let textLayer = "";
  try {
    const proxy = await getDocumentProxy(new Uint8Array(bytes));
    const extracted = await extractText(proxy, { mergePages: true });
    textLayer = extracted.text ?? "";
  } catch (err) {
    logger?.warn?.(`pdf text-layer extraction failed: ${(err as Error).message?.slice(0, 120)}`);
  }
  const isDigital = textLayer.trim().length >= pageCount * 50;

  let transcript: string;
  if (pageCount <= SINGLE_CALL_PAGES) {
    await onProgress?.({ current: 0, total: 1, phase: "transcribing document", detail: `转写 PDF（${pageCount} 页）` });
    const r = await transcribePdf(bytes, { pageCount, logger });
    if (!r || !r.text) throw new Error("PDF 转写失败");
    if (r.finishReason === "length") flags.push({ type: "truncated", detail: "转写达到输出上限，结尾可能不完整" });
    transcript = r.text;
    await onProgress?.({ current: 1, total: 1, phase: "transcribing document", detail: "PDF 转写完成" });
  } else {
    // 1-page overlap so cross-page tables aren't severed; dedup by PAGE marker.
    const parts: string[] = [];
    const starts: number[] = [];
    for (let s = 0; s < pageCount; s += CHUNK_PAGES - 1) starts.push(s);
    for (let i = 0; i < starts.length; i++) {
      const start = starts[i]!;
      const end = Math.min(start + CHUNK_PAGES, pageCount);
      await onProgress?.({
        current: start,
        total: pageCount,
        phase: "transcribing document",
        detail: `转写第 ${start + 1}-${end} 页 / 共 ${pageCount} 页`,
      });
      const sub = await PDFDocument.create();
      const copied = await sub.copyPages(src, Array.from({ length: end - start }, (_, k) => start + k));
      for (const p of copied) sub.addPage(p);
      const subBytes = await sub.save();
      const r = await transcribePdf(new Uint8Array(subBytes), {
        pageCount: end - start,
        pageStart: start + 1,
        logger,
      });
      if (!r || !r.text) {
        flags.push({ type: "truncated", detail: `第 ${start + 1}-${end} 页转写失败` });
        continue;
      }
      parts.push(r.text);
      if (end >= pageCount) break;
    }
    transcript = dedupByPageMarker(parts);
    await onProgress?.({ current: pageCount, total: pageCount, phase: "transcribing document", detail: "PDF 转写完成" });
  }

  if (isDigital) {
    // Transcription digits must exist in the file's own text layer; our own PAGE markers carry
    // digits that layer never has, so strip them first.
    const layerDigits = digitTokens(textLayer);
    const withoutMarkers = transcript.replace(/^--- PAGE \d+ ---$/gm, "");
    const suspect = [...digitTokens(withoutMarkers)].filter((n) => !layerDigits.has(n));
    if (suspect.length > 0) {
      flags.push({
        type: "audit_source",
        detail: `转写中 ${suspect.length} 个数字未在 PDF 文本层找到，可能识别有误：${suspect.slice(0, 10).join(", ")}${suspect.length > 10 ? "…" : ""}`,
      });
    }
  } else {
    // Scanned: no text layer, so verify the numbers against the document itself.
    const { diffs, checked } = await verifyPdfNumbers(bytes, transcript, logger);
    for (const d of diffs.slice(0, 20)) {
      flags.push({ type: "audit_source", detail: `扫描件数字复核不一致：${d}` });
    }
    // An unchecked or partially-checked scan must not look like a clean audit.
    if (checked !== "full") {
      flags.push({
        type: "audit_source",
        detail:
          checked === "failed"
            ? "扫描件数字复核未能完成（核对调用失败），文中数字未经与原件比对，请自行核对"
            : `扫描件数字复核只覆盖了前 ${PDF_VERIFY_CHARS.toLocaleString("en-US")} 字，其后的数字未与原件比对，请自行核对`,
      });
    }
  }
  return transcript;
}

function dedupByPageMarker(parts: string[]): string {
  const seen = new Set<number>();
  const out: string[] = [];
  for (const part of parts) {
    const segments = part.split(/^(?=--- PAGE \d+ ---)/m);
    for (const seg of segments) {
      const m = seg.match(/^--- PAGE (\d+) ---/);
      if (m) {
        const n = Number(m[1]);
        if (seen.has(n)) continue;
        seen.add(n);
      }
      if (seg.trim()) out.push(seg.trim());
    }
  }
  return out.join("\n\n");
}

async function transcribeDocx(
  bytes: Uint8Array,
  flags: ImportFlag[],
  onProgress?: (p: ImportProgress) => void | Promise<void>,
  logger?: Logger,
): Promise<{ transcript: string; imagesTotal: number }> {
  const buffer = Buffer.from(bytes);
  const images: { token: string; bytes: Uint8Array }[] = [];
  const seenMedia = new Set<string>();

  // convertToHtml, not markdown: mammoth's md path drops table structure.
  const result = await mammoth.convertToHtml(
    { buffer },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        const data = await image.read();
        const token = `IMGTOKEN_${images.length}`;
        images.push({ token, bytes: new Uint8Array(data) });
        return { src: token };
      }),
    },
  );
  let body = result.value ?? "";

  // mammoth drops anchored/floating images (common in WPS-authored Chinese docs), so reconcile
  // against the raw zip and append what it missed.
  try {
    const zip = unzipSync(new Uint8Array(bytes), { filter: (f) => f.name.startsWith("word/media/") });
    const mediaNames = Object.keys(zip);
    for (const img of images) seenMedia.add(hashBytes(img.bytes));
    const missed: Uint8Array[] = [];
    for (const name of mediaNames) {
      const data = zip[name]!;
      if (!seenMedia.has(hashBytes(data))) missed.push(data);
    }
    for (const data of missed) {
      const token = `IMGTOKEN_${images.length}`;
      images.push({ token, bytes: data });
      body += `\n\n<h2>附：文档内嵌图片</h2><img src="${token}" />`;
    }
    if (missed.length > 0) logger?.info?.(`docx reconcile: appended ${missed.length} media not surfaced by mammoth`);
  } catch (err) {
    logger?.warn?.(`docx media reconcile failed: ${(err as Error).message?.slice(0, 120)}`);
  }

  let clipped = images;
  if (images.length > MAX_DOCX_IMAGES) {
    flags.push({ type: "truncated", detail: `文档含 ${images.length} 张图片，仅转写前 ${MAX_DOCX_IMAGES} 张` });
    clipped = images.slice(0, MAX_DOCX_IMAGES);
  }

  let done = 0;
  const transcriptions = await runPool(clipped, 4, async (img) => {
    const r = await transcribeImage(img.bytes, { hint: "通常是电子表格截图", logger });
    done++;
    await onProgress?.({
      current: done,
      total: clipped.length,
      phase: "transcribing document",
      detail: `转写内嵌图表 ${done}/${clipped.length}`,
    });
    return r?.text ?? null;
  });

  let failed = 0;
  for (let i = 0; i < clipped.length; i++) {
    const img = clipped[i]!;
    const text = transcriptions[i];
    let replacement: string;
    if (!text) {
      failed++;
      replacement = "[图表转写失败]";
    } else if (text.includes(DECORATIVE_MARK)) {
      replacement = "";
    } else {
      replacement = `\n${text}\n`;
    }
    body = body.replace(new RegExp(`<img[^>]*${img.token}[^>]*>`, "g"), replacement).split(img.token).join(replacement);
  }
  for (const img of images.slice(clipped.length)) {
    body = body.replace(new RegExp(`<img[^>]*${img.token}[^>]*>`, "g"), "[图片未转写]").split(img.token).join("[图片未转写]");
  }
  if (failed > 0) {
    flags.push({ type: "image_failed", detail: `${failed} 张内嵌图表转写失败，内容可能缺失，请对照原文件补充` });
  }

  // An image has no text layer, so a digit vision invented here is invisible to every later
  // check (the bible audit only compares bible against this transcript). Bounded: each check is
  // another vision call, and the pool is the slowest phase of the import.
  const numeric = clipped
    .map((img, i) => ({ img, text: transcriptions[i] }))
    .filter((x): x is { img: (typeof clipped)[number]; text: string } => Boolean(x.text) && /\d/.test(x.text!));
  const toVerify = numeric.slice(0, MAX_DOCX_VERIFY);
  if (numeric.length > toVerify.length) {
    flags.push({
      type: "audit_source",
      detail: `${numeric.length} 张内嵌图表含数字，仅复核了前 ${toVerify.length} 张；其余图表中的数字未与原图比对，请自行核对`,
    });
  }
  if (toVerify.length > 0) {
    let verified = 0;
    const results = await runPool(toVerify, 4, async ({ img, text }) => {
      const r = await verifyImageNumbers(img.bytes, text, logger);
      verified++;
      await onProgress?.({
        current: verified,
        total: toVerify.length,
        phase: "transcribing document",
        detail: `复核图表数字 ${verified}/${toVerify.length}`,
      });
      return r;
    });
    for (const d of results.flatMap((r) => r.diffs).slice(0, 20)) {
      flags.push({ type: "audit_source", detail: `内嵌图表数字复核不一致：${d}` });
    }
    const unchecked = results.filter((r) => !r.ok).length;
    if (unchecked > 0) {
      flags.push({
        type: "audit_source",
        detail: `${unchecked} 张内嵌图表的数字复核调用失败，其中的数字未与原图比对，请自行核对`,
      });
    }
  }
  // Cropped spreadsheet previews lose their right side at the source — no extractor can
  // recover data that isn't in the file.
  if (/点击图片可?查看完整/.test(body)) {
    flags.push({
      type: "truncated",
      detail: "文档中的表格为在线表格的截图预览，部分内容在原文件中已被裁切；建议向文档提供方索取完整导出版",
    });
  }
  return { transcript: body.trim(), imagesTotal: clipped.length };
}

function hashBytes(b: Uint8Array): string {
  // djb2 over sampled bytes: cheap identity for reconcile, not cryptographic.
  let h = 5381;
  const step = Math.max(1, Math.floor(b.length / 256));
  for (let i = 0; i < b.length; i += step) h = ((h << 5) + h + b[i]!) >>> 0;
  return `${b.length}:${h}`;
}

