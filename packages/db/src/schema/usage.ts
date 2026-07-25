import { index, integer, numeric, pgTable, real, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { users } from "./users";

// Append-only cost telemetry, never shown to users; quotas live on usage_counters.
export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    runId: uuid("run_id"),
    feature: text("feature"),
    resourceType: text("resource_type").notNull(),
    provider: text("provider").notNull(),
    model: text("model"),
    inputTokens: integer("input_tokens"),
    cachedInputTokens: integer("cached_input_tokens"),
    outputTokens: integer("output_tokens"),
    audioSeconds: real("audio_seconds"),
    apiCalls: integer("api_calls"),
    estimatedCostUsd: numeric("estimated_cost_usd", { precision: 12, scale: 6 }),
    priceVersion: text("price_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userCreatedIdx: index("usage_events_user_created_idx").on(table.userId, table.createdAt),
    runIdx: index("usage_events_run_idx").on(table.runId),
  }),
);

export type UsageEventRow = typeof usageEvents.$inferSelect;
export type NewUsageEventRow = typeof usageEvents.$inferInsert;
