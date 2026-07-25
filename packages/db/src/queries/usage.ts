import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { usageEvents } from "../schema/usage";

// Schema-generic-agnostic so both the bare worker client and the schema-typed web client fit.
type DbLike = { insert: PostgresJsDatabase["insert"] };

// Structural twin of @goooose/integrations/metering UsageEvent (db must not depend on integrations).
export type MeteredEvent = {
  userId?: string;
  runId?: string;
  feature?: string;
  resourceType: "llm" | "asr" | "scrape" | "vision";
  provider: string;
  model?: string;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  audioSeconds?: number;
  apiCalls?: number;
};

export const PRICE_VERSION = "2026-07-promo";

// USD per 1M tokens; cached input ≈ 2% of input (DeepSeek cache-hit pricing).
const LLM_PRICES: Record<string, { input: number; output: number; cachedInput: number }> = {
  "deepseek-v4-pro": { input: 0.435, output: 0.87, cachedInput: 0.0087 },
  "deepseek-v4-flash": { input: 0.14, output: 0.28, cachedInput: 0.0028 },
  "claude-sonnet-4-6": { input: 3, output: 15, cachedInput: 0.3 },
  // Priced at its post-promo steady state (promo $2/$10/$0.20 runs through 2026-08-31) so
  // cost baselines do not jump the day it lapses.
  "claude-sonnet-5": { input: 3, output: 15, cachedInput: 0.3 },
};

// USD per minute of audio.
const ASR_PRICES: Record<string, number> = {
  deepgram: 0.0043,
  qwen: 0.0021,
  youtube_auto: 0,
};

const SCRAPE_PRICE_PER_CALL = 0.003;

export function estimateCostUsd(event: MeteredEvent): number {
  if (event.resourceType === "llm" || event.resourceType === "vision") {
    const price = LLM_PRICES[event.model ?? ""];
    if (!price) return 0;
    const cached = event.cachedInputTokens ?? 0;
    const freshIn = Math.max((event.inputTokens ?? 0) - cached, 0);
    return (
      (freshIn * price.input + cached * price.cachedInput + (event.outputTokens ?? 0) * price.output) /
      1_000_000
    );
  }
  if (event.resourceType === "asr") {
    const perMin = ASR_PRICES[event.provider] ?? ASR_PRICES.deepgram!;
    return ((event.audioSeconds ?? 0) / 60) * perMin;
  }
  return (event.apiCalls ?? 1) * SCRAPE_PRICE_PER_CALL;
}

function toRow(event: MeteredEvent) {
  return {
    userId: event.userId ?? null,
    runId: event.runId ?? null,
    feature: event.feature ?? null,
    resourceType: event.resourceType,
    provider: event.provider,
    model: event.model ?? null,
    inputTokens: event.inputTokens ?? null,
    cachedInputTokens: event.cachedInputTokens ?? null,
    outputTokens: event.outputTokens ?? null,
    audioSeconds: event.audioSeconds ?? null,
    apiCalls: event.apiCalls ?? null,
    estimatedCostUsd: estimateCostUsd(event).toFixed(6),
    priceVersion: PRICE_VERSION,
  };
}

// Worker pattern: the batched insert must land before the task's DB client closes —
// fire-and-forget would race client.end().
export function createUsageBuffer() {
  const events: MeteredEvent[] = [];
  return {
    push: (event: MeteredEvent) => {
      events.push(event);
    },
    flush: async (db: DbLike) => {
      if (events.length === 0) return;
      const rows = events.splice(0).map(toRow);
      await db.insert(usageEvents).values(rows);
    },
    size: () => events.length,
  };
}

// Web pattern: the singleton client outlives the request, so fire-and-forget is safe.
export function createUsageSink(db: DbLike) {
  return (event: MeteredEvent) => {
    void db
      .insert(usageEvents)
      .values(toRow(event))
      .catch((err) => console.error("usage sink insert failed", err));
  };
}
