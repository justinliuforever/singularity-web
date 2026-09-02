import { createDeepSeek } from "@ai-sdk/deepseek";
import { generateText, wrapLanguageModel, type LanguageModelMiddleware } from "ai";

import { usageMiddleware } from "../metering";
import { withRequestTimeout } from "../utils";

// Every other client here caps its requests (xhs/douyin/tikhub at 30s, asr on its own
// controller); this one had none, so a stalled DeepSeek connection blocked the calling task
// until Trigger.dev's maxDuration — observed as SOP generation frozen at 1/3 for over an
// hour, holding the account lock the whole time. 10 minutes clears any legitimate call (the
// longest is a 16384-token Pro generation with reasoning) while turning an open-ended hang
// into a normal failure the step can catch and report.
const REQUEST_TIMEOUT_MS = 10 * 60_000;

// Lazy-init: Trigger.dev scans modules at deploy time; defer env throw to first call.
let _deepseek: ReturnType<typeof createDeepSeek> | null = null;

function getDeepseek() {
  if (!_deepseek) {
    if (!process.env.DEEPSEEK_API_KEY) {
      throw new Error("DEEPSEEK_API_KEY not set in env");
    }
    _deepseek = createDeepSeek({
      apiKey: process.env.DEEPSEEK_API_KEY,
      fetch: withRequestTimeout(REQUEST_TIMEOUT_MS),
    });
  }
  return _deepseek;
}

export type LlmTier = "flash" | "pro";

// DeepSeek upgraded the model behind `deepseek-v4-flash` in place (build 0731) to reason by
// default. On our structured prompts it spends the ENTIRE output budget on reasoning and returns
// no text: measured 14/15 empty on the real video-analysis prompt, at every budget from 4096 to
// 16384, and the failure is random rather than size-dependent. Reasoning buys nothing on
// mechanical extraction and rewriting, so it is switched off for the whole tier here rather than
// at each of the call sites. Measured with it off: 3/3 text, 5x faster, 6x fewer output tokens.
const noThinking: LanguageModelMiddleware = {
  specificationVersion: "v3",
  transformParams: async ({ params }) => ({
    ...params,
    providerOptions: {
      ...params.providerOptions,
      deepseek: { ...(params.providerOptions?.deepseek ?? {}), thinking: { type: "disabled" } },
    },
  }),
};

export function llm(tier: LlmTier = "flash") {
  const modelId = tier === "pro" ? "deepseek-v4-pro" : "deepseek-v4-flash";
  const metering = usageMiddleware("llm", "deepseek", modelId);
  return wrapLanguageModel({
    model: getDeepseek()(modelId),
    // Pro keeps its reasoning — that is what it is for, and it stays reliable with it on.
    middleware: tier === "pro" ? metering : [noThinking, metering],
  });
}

// DeepSeek Pro is a reasoning model: on heavy prompts it can burn the whole output budget on
// internal reasoning and return empty text (finishReason="length"), so Flash retries that case.
export async function generateTextWithFallback(opts: {
  prompt: string;
  maxOutputTokens: number;
  temperature?: number;
  maxRetries?: number;
}): Promise<{ text: string; usedTier: LlmTier; finishReason?: string }> {
  const result = await generateText({
    model: llm("pro"),
    prompt: opts.prompt,
    maxOutputTokens: opts.maxOutputTokens,
    temperature: opts.temperature ?? 0.3,
    maxRetries: opts.maxRetries ?? 2,
  });
  if (result.text.length > 0) {
    return { text: result.text, usedTier: "pro", finishReason: result.finishReason ?? undefined };
  }
  const fallback = await generateText({
    model: llm("flash"),
    prompt: opts.prompt,
    maxOutputTokens: opts.maxOutputTokens,
    temperature: opts.temperature ?? 0.3,
    maxRetries: opts.maxRetries ?? 2,
  });
  return { text: fallback.text, usedTier: "flash", finishReason: fallback.finishReason ?? undefined };
}
