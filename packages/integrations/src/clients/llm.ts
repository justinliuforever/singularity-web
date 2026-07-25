import { createDeepSeek } from "@ai-sdk/deepseek";
import { generateText, wrapLanguageModel } from "ai";

import { usageMiddleware } from "../metering";

// Lazy-init: Trigger.dev scans modules at deploy time; defer env throw to first call.
let _deepseek: ReturnType<typeof createDeepSeek> | null = null;

function getDeepseek() {
  if (!_deepseek) {
    if (!process.env.DEEPSEEK_API_KEY) {
      throw new Error("DEEPSEEK_API_KEY not set in env");
    }
    _deepseek = createDeepSeek({ apiKey: process.env.DEEPSEEK_API_KEY });
  }
  return _deepseek;
}

export type LlmTier = "flash" | "pro";

export function llm(tier: LlmTier = "flash") {
  const modelId = tier === "pro" ? "deepseek-v4-pro" : "deepseek-v4-flash";
  return wrapLanguageModel({
    model: getDeepseek()(modelId),
    middleware: usageMiddleware("llm", "deepseek", modelId),
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
