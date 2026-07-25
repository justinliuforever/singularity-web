import { streamText } from "ai";

import { llm } from "@goooose/integrations/clients/llm";
import { redactUngrounded } from "../grounding";
import { buildChannelBiblePrompt } from "@goooose/prompts/poet";
import type { DriftWarning } from "../../schemas/poet";

const BIAS_MARKERS = [
  "AI",
  "LLM",
  "ChatGPT",
  "Midjourney",
  "Runway",
  "machine learning",
  "人工智能",
  "大模型",
] as const;

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "of", "for", "to", "from", "in",
  "on", "at", "with", "by", "is", "are", "was", "were", "be", "been",
  "being", "this", "that", "these", "those", "it", "its", "as", "i", "we",
  "you", "he", "she", "they", "my", "your", "his", "her", "their", "our",
  "channel", "video", "videos", "content", "audience", "viewer", "viewers",
  "topic", "topics", "idea", "ideas", "youtube",
  "的", "和", "与", "是", "在", "我", "你", "他", "她", "们", "也", "都",
  "了", "就", "把", "从", "到", "对", "为", "频道", "视频", "内容",
]);

// Bigrams containing these are skipped so "的日"/"了一" noise can't mask real drift.
const ZH_CHAR_STOP = new Set([
  "的", "和", "与", "是", "在", "我", "你", "他", "她", "们", "也", "都",
  "了", "就", "把", "从", "到", "对", "为", "一", "个", "这", "那", "有",
]);

function tokenize(text: string): Set<string> {
  // CJK bigrams, not whole runs: a whole-run token needs exact phrase equality between
  // input and claimed topic, which flagged no_overlap on nearly every zh bible.
  const out = new Set<string>();
  const tokens = text.toLowerCase().match(/[a-z0-9_]+|[一-鿿]+/g) ?? [];
  for (const t of tokens) {
    if (/^[一-鿿]/.test(t)) {
      for (let i = 0; i + 2 <= t.length; i++) {
        const a = t[i]!;
        const b = t[i + 1]!;
        if (ZH_CHAR_STOP.has(a) || ZH_CHAR_STOP.has(b)) continue;
        const bg = a + b;
        if (!STOPWORDS.has(bg)) out.add(bg);
      }
    } else if (!STOPWORDS.has(t) && t.length >= 2) {
      out.add(t);
    }
  }
  return out;
}

function extractTopicLine(content: string): string {
  const m = content.match(/^\s*TOPIC:\s*(.+?)\s*$/m);
  return m ? m[1]!.trim() : "";
}

export function extractHostLine(content: string): string | null {
  const m = content.match(/^\s*HOST:\s*(.+?)\s*$/m);
  return m ? m[1]!.trim() || null : null;
}

export const BIBLE_ANCHORS = [
  "POSITIONING",
  "PERSONA",
  "AUDIENCE",
  "CONTENT_PILLARS",
  "CONTENT_RULES",
  "METHODOLOGY",
  "INFORMATION_SOURCES",
  "TOPIC_FRAMEWORK",
  "FACT_SHEET",
] as const;

export type BibleAnchor = (typeof BIBLE_ANCHORS)[number];

// Legacy bibles (no anchors) fall back to the whole content, keeping pre-R6 behavior.
export function selectBibleSections(content: string, anchors: readonly BibleAnchor[]): string {
  const hasAnyAnchor = BIBLE_ANCHORS.some((a) => new RegExp(`^##\\s+${a}\\b`, "m").test(content));
  if (!hasAnyAnchor) return content;
  const parts: string[] = [];
  for (const anchor of anchors) {
    const re = new RegExp(`^(##\\s+${anchor}\\b[^\\n]*)\\n([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, "m");
    const m = content.match(re);
    if (!m) continue;
    const body = m[2]!.trim();
    if (!body || body === "（暂无，可后续补充）") continue;
    parts.push(`${m[1]!.trim()}\n${body}`);
  }
  if (parts.length === 0) return content;
  const topic = extractTopicLine(content);
  const host = extractHostLine(content);
  const head = [topic ? `TOPIC: ${topic}` : "", host ? `HOST: ${host}` : ""].filter(Boolean).join("\n");
  return [head, ...parts].filter(Boolean).join("\n\n");
}

function intersects(a: Set<string>, b: Set<string>): boolean {
  for (const t of a) if (b.has(t)) return true;
  return false;
}

function checkDrift(
  userInput: string,
  topicClaimed: string,
  content: string,
): DriftWarning | null {
  const userInputLower = userInput.toLowerCase();
  const userTokens = tokenize(userInput);
  const topicTokens = topicClaimed ? tokenize(topicClaimed) : new Set<string>();

  if (
    topicClaimed &&
    userTokens.size > 0 &&
    topicTokens.size > 0 &&
    !intersects(userTokens, topicTokens)
  ) {
    return {
      reason: "no_overlap",
      claimedTopic: topicClaimed,
      sampleUserTerms: [...userTokens].sort().slice(0, 8),
      humanMessage: `The Bible's claimed topic ("${topicClaimed}") shares no content words with what you described. The LLM may have substituted the topic.`,
    };
  }

  const userHasMarker = BIAS_MARKERS.some((m) => userInputLower.includes(m.toLowerCase()));
  if (!userHasMarker) {
    const contentLower = content.toLowerCase();
    let markerHits = 0;
    for (const m of BIAS_MARKERS) {
      const needle = m.toLowerCase();
      let from = 0;
      while (true) {
        const idx = contentLower.indexOf(needle, from);
        if (idx === -1) break;
        markerHits++;
        from = idx + needle.length;
      }
    }
    if (markerHits >= 3) {
      return {
        reason: "ai_markers",
        claimedTopic: topicClaimed,
        sampleUserTerms: [...userTokens].sort().slice(0, 8),
        markerHits,
        humanMessage: `The Bible mentions AI/LLM/ChatGPT-style topics ${markerHits} times even though you didn't ask for that. The LLM may have substituted your niche.`,
      };
    }
  }

  return null;
}

export type BibleResult = {
  content: string;
  topicClaimed: string;
  driftWarning: DriftWarning | null;
};

export type GenerateBibleArgs = {
  ideaText: string;
  channelDescription: string;
  language?: "en" | "zh";
};

export async function generateChannelBible(
  args: GenerateBibleArgs,
  onProgress?: (charCount: number) => void | Promise<void>,
): Promise<BibleResult> {
  const prompt = buildChannelBiblePrompt({
    ideaText: args.ideaText,
    channelDescription: args.channelDescription,
    language: args.language,
  });
  // Flash, not Pro: structured brief, not deep reasoning — A/B showed 2.4-3.5× faster at equal quality.
  let content = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = streamText({
      model: llm("flash"),
      prompt,
      temperature: 0.4,
      maxOutputTokens: 16384,
      maxRetries: 2,
    });
    let acc = "";
    let lastTick = 0;
    for await (const delta of result.textStream) {
      acc += delta;
      if (onProgress && acc.length - lastTick >= 300) {
        lastTick = acc.length;
        await onProgress(acc.length);
      }
    }
    content = acc.trim();
    if (content.length > 0) break;
  }
  content = await redactUngrounded({
    draft: content,
    source: `${args.channelDescription}\n\n${args.ideaText}`,
    language: args.language,
  });
  const topicClaimed = extractTopicLine(content);
  const driftWarning = checkDrift(
    `${args.ideaText}\n${args.channelDescription}`,
    topicClaimed,
    content,
  );
  return { content, topicClaimed, driftWarning };
}

export { BIAS_MARKERS, STOPWORDS, tokenize, extractTopicLine, checkDrift };
