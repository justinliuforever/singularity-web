import { AsyncLocalStorage } from "node:async_hooks";

import type { LanguageModelV3Middleware, LanguageModelV3StreamPart } from "@ai-sdk/provider";

export type UsageEventInput = {
  resourceType: "llm" | "asr" | "scrape" | "vision";
  provider: string;
  model?: string;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  audioSeconds?: number;
  apiCalls?: number;
};

export type UsageEvent = UsageEventInput & {
  userId?: string;
  runId?: string;
  feature?: string;
};

export type UsageContext = {
  userId?: string;
  runId?: string;
  feature?: string;
  sink: (event: UsageEvent) => void;
};

const storage = new AsyncLocalStorage<UsageContext>();

export function runWithUsage<T>(ctx: UsageContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}

// No-op outside a usage context so clients stay usable in scripts/smoke tests.
export function recordUsage(event: UsageEventInput): void {
  const ctx = storage.getStore();
  if (!ctx) return;
  try {
    ctx.sink({ ...event, userId: ctx.userId, runId: ctx.runId, feature: ctx.feature });
  } catch {
    /* metering must never break the call it observes */
  }
}

type V3Usage = {
  inputTokens: { total: number | undefined; cacheRead: number | undefined };
  outputTokens: { total: number | undefined };
};

function recordLlmUsage(kind: "llm" | "vision", provider: string, model: string, usage: V3Usage) {
  recordUsage({
    resourceType: kind,
    provider,
    model,
    inputTokens: usage.inputTokens.total ?? 0,
    cachedInputTokens: usage.inputTokens.cacheRead ?? 0,
    outputTokens: usage.outputTokens.total ?? 0,
    apiCalls: 1,
  });
}

// Single choke point: wrapping the model meters every call site without touching it.
export function usageMiddleware(
  kind: "llm" | "vision",
  provider: string,
  model: string,
): LanguageModelV3Middleware {
  return {
    specificationVersion: "v3",
    wrapGenerate: async ({ doGenerate }) => {
      const result = await doGenerate();
      recordLlmUsage(kind, provider, model, result.usage as V3Usage);
      return result;
    },
    wrapStream: async ({ doStream }) => {
      const result = await doStream();
      const transform = new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>({
        transform(part, controller) {
          if (part.type === "finish") {
            recordLlmUsage(kind, provider, model, part.usage as V3Usage);
          }
          controller.enqueue(part);
        },
      });
      return { ...result, stream: result.stream.pipeThrough(transform) };
    },
  };
}
