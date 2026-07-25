// Thumbnail vision via Claude Sonnet — DeepSeek V4 is text-only.

import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, wrapLanguageModel } from "ai";
import { usageMiddleware } from "../metering";
import { parseLlmJson } from "../utils";

let _anthropic: ReturnType<typeof createAnthropic> | null = null;

function getAnthropic() {
  if (!_anthropic) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set in env");
    _anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _anthropic;
}

export type ThumbnailAnalysis = {
  description: string;
  whyItWorks: string;
  diagnosis: string | null;
  titleSuggestions: string[];
};

// The SOP's cover playbook is built from `description` + `why_it_works`, so they must carry the
// concrete material (verbatim overlay text, composition, props) rather than a gist.
const ZH_INSTRUCTION = `你是封面（首图/缩略图）视觉分析师。你没有被告知这条内容的标题，也不要试图推测标题——只描述画面。输出严格的 JSON：

{
  "description": "用 5-7 句中文拆解画面：(1) 构图——主体是什么、在画面什么位置、景别与留白；(2) 配色——主色与对比色、明暗关系，说清楚是「色块底衬」还是「文字本身有颜色」；(3) 画面里的文字——逐字照抄原文并标明层级（主标题/副标题/角标），无文字写「无文字」；(4) 人物——几个人、表情、动作、穿着，无人物写「无人物」；(5) 道具与场景——具体物件名称，无道具写「无道具」。只写你真实看到的：看不清就写「看不清」，绝不猜测、绝不补全画面里没有的元素。不要给出画面里不存在的数值（不要估算色值或面积占比，除非画面上直接写着）。",
  "why_it_works": "用 2-3 句中文说明最有效的视觉动作是什么、为什么能让人点进来。必须指名画面里的具体元素（哪块文字、哪个颜色、哪个表情、哪件道具）。",
  "diagnosis": "用 1-2 句中文诊断这张封面最薄弱处或最该改的一点（例如：文字过多、对比度低、主体不清、信息密度问题等）。不要提及任何平台名称（YouTube / 小红书 / 抖音）——只诊断画面本身。如果封面已经非常优秀无明显问题，写 null",
  "title_suggestions": ["3 个备选中文标题，每个不超过 25 字，与封面视觉强匹配，并包含具体数字/对比/反差/情绪点之一"]
}

只返回 JSON，不要 markdown 代码块。`;

const EN_INSTRUCTION = `You are a cover (thumbnail / first image) visual analyst. You have not been told this post's title — do not guess it; describe only the image. Output strict JSON:

{
  "description": "5-7 sentences breaking the image down: (1) composition — the subject, where it sits, shot size, negative space; (2) palette — dominant and contrast colours, light/dark relationship, and whether colour is a BLOCK behind the text or the text itself; (3) on-image text — copied character-for-character with its level (main title / subtitle / corner tag), or 'no text'; (4) people — how many, expression, action, clothing, or 'no people'; (5) props and setting — name the objects, or 'no props'. Write only what you actually see: if something is illegible, say so. Never guess, never complete elements that are not there. Do not state figures the image does not show (no colour codes, no % of frame) unless printed on the image.",
  "why_it_works": "2-3 sentences on the single most effective visual move and why it earns the click. Name the specific element (which text, which colour, which expression, which prop).",
  "diagnosis": "1-2 sentences diagnosing the weakest aspect of this cover or what could be improved (e.g. too much text, low contrast, unclear subject, info density). Do not name any platform (YouTube / Xiaohongshu / Douyin) — diagnose the image itself. If the cover is already excellent with no clear issue, write null.",
  "title_suggestions": ["3 alternative title candidates, each ≤ 70 chars, tightly matching the visual, each leveraging concrete numbers / contrast / surprise / emotion"]
}

Return JSON only, no markdown fences.`;

// The AI SDK's URL-mode fetcher honors robots.txt and some CDNs (XHS rednotecdn) block it;
// passing bytes bypasses that fetcher entirely.
async function fetchImageBytes(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

async function parseLenient(raw: string): Promise<{
  description?: unknown;
  why_it_works?: unknown;
  diagnosis?: unknown;
  title_suggestions?: unknown;
} | null> {
  try {
    return (await parseLlmJson(raw)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function analyzeThumbnail(
  thumbnailUrl: string,
  language: "en" | "zh" = "zh",
  logger?: { warn: (msg: string) => void },
): Promise<ThumbnailAnalysis | null> {
  return analyzeImageStack([thumbnailUrl], language, logger);
}

const ZH_STACK_INSTRUCTION = `你是小红书图文笔记视觉分析师。下面是该笔记的多张图片（按顺序）。你没有被告知这条笔记的标题，也不要试图推测标题——只描述画面。输出严格的 JSON：

{
  "description": "用 5-7 句中文：先按 (1) 构图 (2) 配色（说清是「色块底衬」还是「文字本身有颜色」）(3) 画面里的文字（逐字照抄并标层级）(4) 人物（表情/动作/穿着）(5) 道具与场景，拆解第 1 张封面；再用 1-2 句概括整组图片的视觉风格（排版/配色/字体/拼贴方式）。只写你真实看到的：看不清就写「看不清」，绝不猜测、绝不补全画面里没有的元素。不要估算色值或面积占比。",
  "why_it_works": "用 2-3 句中文说明封面最有效的视觉动作是什么、为什么能让人点进来（必须指名具体元素），以及整套图片如何带动用户滑下去看完",
  "diagnosis": "用 1-2 句中文诊断封面（第 1 张）的薄弱处或可改进点（例如：文字过多、对比度低、主体不清、信息密度问题等）。不要提及任何平台名称（YouTube / 小红书 / 抖音）——只诊断画面本身。如果封面已经非常优秀无明显问题，写 null"
}

只返回 JSON，不要 markdown 代码块。`;

const EN_STACK_INSTRUCTION = `You are a Xiaohongshu image-post visual analyst. Below are the post's images in order. You have not been told this post's title — do not guess it; describe only the images. Output strict JSON:

{
  "description": "5-7 sentences: first break down image 1 (the cover) by (1) composition (2) palette — say whether colour is a BLOCK behind the text or the text itself (3) on-image text, copied character-for-character with its level (4) people — expression, action, clothing (5) props and setting. Then 1-2 sentences on the whole set's visual style (layout/palette/typography/collage). Write only what you actually see; if something is illegible, say so. Never guess, never complete elements that are not there. Do not estimate colour codes or % of frame.",
  "why_it_works": "2-3 sentences on the cover's single most effective visual move and why it earns the click (name the specific element), plus how the sequence keeps the reader swiping",
  "diagnosis": "1-2 sentences diagnosing the cover (first image)'s weak spots or improvements (e.g. too much text, low contrast, unclear subject, density issues). Do not name any platform (YouTube / Xiaohongshu / Douyin) — diagnose the image itself. Write null if the cover is already excellent with no clear issue"
}

Return JSON only, no markdown fences.`;

// XHS image-posts: up to 9 images per call so Claude synthesizes the whole gallery, not just the cover.
export async function analyzeImageStack(
  urls: string[],
  language: "en" | "zh" = "zh",
  logger?: { warn: (msg: string) => void },
): Promise<ThumbnailAnalysis | null> {
  try {
    const clipped = urls.filter(Boolean).slice(0, 9);
    if (clipped.length === 0) return null;
    const bytesArr = await Promise.all(clipped.map(fetchImageBytes));
    const valid = bytesArr.filter((b): b is Uint8Array => b !== null);
    if (valid.length === 0) {
      logger?.warn(`vision: all ${clipped.length} image downloads failed`);
      return null;
    }
    if (valid.length < clipped.length) {
      logger?.warn(
        `vision: ${clipped.length - valid.length}/${clipped.length} images failed download, proceeding with ${valid.length}`,
      );
    }
    const single = valid.length === 1;
    const instruction = single
      ? language === "zh"
        ? ZH_INSTRUCTION
        : EN_INSTRUCTION
      : language === "zh"
        ? ZH_STACK_INSTRUCTION
        : EN_STACK_INSTRUCTION;
    const result = await generateText({
      model: wrapLanguageModel({
        model: getAnthropic()("claude-sonnet-5"),
        middleware: usageMiddleware("vision", "anthropic", "claude-sonnet-5"),
      }),
      // Truncation drops the trailing fields while the description/whyItWorks guard below still
      // passes, so the row silently loses the diagnosis that gates the cover read into the SOP.
      maxOutputTokens: 8000,
      maxRetries: 2,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: instruction },
            ...valid.map((b) => ({ type: "image" as const, image: b })),
          ],
        },
      ],
    });
    const parsed = await parseLenient(result.text);
    if (!parsed) {
      logger?.warn(`vision parse failed (${clipped.length} imgs): ${result.text.slice(0, 200)}`);
      return null;
    }
    const description = typeof parsed.description === "string" ? parsed.description.trim() : "";
    const whyItWorks =
      typeof parsed.why_it_works === "string" ? parsed.why_it_works.trim() : "";
    if (!description && !whyItWorks) {
      logger?.warn(`vision returned empty fields (${clipped.length} imgs)`);
      return null;
    }
    const rawDiagnosis = parsed.diagnosis;
    const diagnosis =
      typeof rawDiagnosis === "string" && rawDiagnosis.trim().length > 0 && rawDiagnosis.trim() !== "null"
        ? rawDiagnosis.trim()
        : null;
    const titleSuggestions = Array.isArray(parsed.title_suggestions)
      ? parsed.title_suggestions
          .filter((t): t is string => typeof t === "string")
          .map((t) => t.trim())
          .filter((t) => t.length > 0)
          .slice(0, 5)
      : [];
    return { description, whyItWorks, diagnosis, titleSuggestions };
  } catch (err) {
    logger?.warn(
      `vision threw (${urls.length} imgs): ${(err as Error).message?.slice(0, 200)}`,
    );
    return null;
  }
}
