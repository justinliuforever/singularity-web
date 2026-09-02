import { createDeepSeek } from "@ai-sdk/deepseek";
import { generateText, wrapLanguageModel, type LanguageModelMiddleware } from "ai";

import { usageMiddleware } from "../metering";
import { withRequestTimeout } from "../utils";

// Under the shortest task maxDuration (600s) so a stalled call fails inside the task, not by Trigger's kill.
const REQUEST_TIMEOUT_MS = 9 * 60_000;

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

type FallbackResult = { text: string; usedTier: LlmTier; finishReason?: string };

// Pro reasons inside the same output budget: on the longest prompts it returns empty or cut
// text (finishReason "length"), or runs into the request cap. Flash, which does not reason,
// gets the same budget as pure text; when both are cut the longer answer wins.
export async function generateTextWithFallback(opts: {
  prompt: string;
  maxOutputTokens: number;
  temperature?: number;
  maxRetries?: number;
}): Promise<FallbackResult> {
  const run = async (tier: LlmTier): Promise<FallbackResult> => {
    const r = await generateText({
      model: llm(tier),
      prompt: opts.prompt,
      maxOutputTokens: opts.maxOutputTokens,
      temperature: opts.temperature ?? 0.3,
      maxRetries: opts.maxRetries ?? 2,
    });
    return { text: r.text, usedTier: tier, finishReason: r.finishReason ?? undefined };
  };

  let pro: FallbackResult | null = null;
  try {
    pro = await run("pro");
  } catch (err) {
    if (!isRequestAbort(err)) throw err;
  }
  if (pro && pro.text.length > 0 && pro.finishReason !== "length") return pro;

  const flash = await run("flash");
  if (pro && flash.finishReason === "length" && pro.text.length > flash.text.length) return pro;
  return flash;
}

function isRequestAbort(err: unknown): boolean {
  const name = (err as { name?: unknown } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
}
