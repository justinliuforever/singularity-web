import { boolean, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { channels } from "./channels";
import { competitorAccounts } from "./competitor";
import { projects } from "./project";
import { pipelineRuns } from "./runs";

export const museMonitorVideos = pgTable(
  "muse_monitor_videos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channelId: uuid("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    competitorAccountId: uuid("competitor_account_id").references(() => competitorAccounts.id, { onDelete: "set null" }),
    platformVideoId: text("platform_video_id").notNull(),
    title: text("title").notNull(),
    url: text("url").notNull(),
    sourceChannelName: text("source_channel_name"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    durationSec: integer("duration_sec"),
    transcript: text("transcript"),
    relevant: boolean("relevant"),
    topicClassification: text("topic_classification"),
    rejectionReason: text("rejection_reason"),
    processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
    runId: uuid("run_id").references(() => pipelineRuns.id, { onDelete: "set null" }),
  },
  (table) => ({
    // Project-scoped, so two projects of the same account can each store the same video.
    projectVideoUnique: unique("muse_monitor_videos_project_video_unique").on(
      table.projectId,
      table.platformVideoId,
    ),
    channelIdx: index("muse_monitor_videos_channel_id_idx").on(table.channelId),
    // Per-run settlement sums durations WHERE run_id on every monitor completion.
    runIdx: index("muse_monitor_videos_run_id_idx").on(table.runId),
  })
);

export const museIdeas = pgTable(
  "muse_ideas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channelId: uuid("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    sourceVideoId: uuid("source_video_id").references(() => museMonitorVideos.id, { onDelete: "set null" }),
    ideaNumber: integer("idea_number").notNull(),
    storyAngle: text("story_angle"),
    factsAndData: text("facts_and_data"),
    whySimilar: text("why_similar"),
    viralTrigger: text("viral_trigger"),
    coverConcept: text("cover_concept"),
    suggestedHookType: text("suggested_hook_type"),
    riskFactors: text("risk_factors"),
    approved: boolean("approved").notNull().default(false),
    scripted: boolean("scripted").notNull().default(false),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    runId: uuid("run_id").references(() => pipelineRuns.id, { onDelete: "set null" }),
  },
  (table) => ({
    videoIdeaUnique: unique("muse_ideas_source_video_idea_unique").on(
      table.sourceVideoId,
      table.ideaNumber,
    ),
    queueIdx: index("muse_ideas_queue_idx").on(table.channelId, table.approved, table.scripted),
  })
);

export type MuseMonitorVideo = typeof museMonitorVideos.$inferSelect;
export type NewMuseMonitorVideo = typeof museMonitorVideos.$inferInsert;
export type MuseIdea = typeof museIdeas.$inferSelect;
export type NewMuseIdea = typeof museIdeas.$inferInsert;
