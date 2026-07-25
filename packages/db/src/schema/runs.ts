import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { channels } from "./channels";
import { competitorAccounts } from "./competitor";
import { ownAccounts } from "./own-account";
import { projects } from "./project";
import { users } from "./users";

export const agentEnum = pgEnum("agent", ["clerk", "muse", "poet"]);
export const runStatusEnum = pgEnum("run_status", ["pending", "running", "done", "failed"]);

export const pipelineRuns = pgTable(
  "pipeline_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // CHECK pipeline_runs_one_owner: clerk runs may target a competitor instead of a channel,
    // muse/poet runs always carry channel_id.
    channelId: uuid("channel_id").references(() => channels.id, { onDelete: "cascade" }),
    competitorAccountId: uuid("competitor_account_id").references(() => competitorAccounts.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    ownAccountId: uuid("own_account_id").references(() => ownAccounts.id, { onDelete: "set null" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    // Minutes charged at trigger; refunded exactly once if the run ends without its artifact.
    quotaCharged: integer("quota_charged").notNull().default(0),
    quotaRefunded: boolean("quota_refunded").notNull().default(false),
    agent: agentEnum("agent").notNull(),
    command: text("command").notNull(),
    status: runStatusEnum("status").notNull().default("pending"),
    progress: integer("progress").notNull().default(0),
    total: integer("total").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    configJson: jsonb("config_json"),
  },
  (table) => ({
    channelStatusIdx: index("pipeline_runs_channel_status_idx").on(table.channelId, table.status),
    competitorStatusIdx: index("pipeline_runs_competitor_status_idx")
      .on(table.competitorAccountId, table.status)
      .where(sql`${table.competitorAccountId} is not null`),
    // Admin ops monitor filters by status and orders by started_at across all users.
    statusStartedIdx: index("pipeline_runs_status_started_idx").on(table.status, table.startedAt),
  })
);

export type PipelineRun = typeof pipelineRuns.$inferSelect;
export type NewPipelineRun = typeof pipelineRuns.$inferInsert;
