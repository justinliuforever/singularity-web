import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { channels } from "./channels";
import { competitorAccounts } from "./competitor";
import { ownAccounts } from "./own-account";
import { pipelineRuns } from "./runs";

export type VerbatimFact = {
  fact: string;
  src: string;
};

export const clerkVideos = pgTable(
  "clerk_videos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // CHECK clerk_videos_one_owner (XOR): own rows carry channel_id+own_account_id, competitor
    // rows carry competitor_account_id.
    channelId: uuid("channel_id").references(() => channels.id, { onDelete: "cascade" }),
    ownAccountId: uuid("own_account_id").references(() => ownAccounts.id, { onDelete: "cascade" }),
    competitorAccountId: uuid("competitor_account_id").references(() => competitorAccounts.id, { onDelete: "cascade" }),
    platformVideoId: text("platform_video_id").notNull(),
    title: text("title").notNull(),
    url: text("url").notNull(),
    views: bigint("views", { mode: "number" }),
    durationSec: integer("duration_sec"),
    thumbnailUrl: text("thumbnail_url"),
    sourceChannelName: text("source_channel_name"),
    sourceChannelId: text("source_channel_id"),
    transcript: text("transcript"),
    transcriptSource: text("transcript_source"),
    contentType: text("content_type").notNull().default("video"),
    thumbnailDescription: text("thumbnail_description"),
    thumbnailWhyItWorks: text("thumbnail_why_it_works"),
    coverDiagnosis: text("cover_diagnosis"),
    coverTitleSuggestions: jsonb("cover_title_suggestions").$type<string[]>(),
    // Explicit provenance: "vision ran" cannot be inferred from coverDiagnosis/coverTitleSuggestions
    // — the multi-image path returns no suggestions and a clean cover has a null diagnosis.
    coverVisionAt: timestamp("cover_vision_at", { withTimezone: true }),
    openingHook: text("opening_hook"),
    openingHookType: text("opening_hook_type"),
    hooksThroughout: text("hooks_throughout"),
    allHookTypes: text("all_hook_types"),
    textHook: text("text_hook"),
    framework: text("framework"),
    openingStructure: text("opening_structure"),
    scriptStructure: text("script_structure"),
    storytellingFramework: text("storytelling_framework"),
    rehooksUsed: text("rehooks_used"),
    retentionPattern: text("retention_pattern"),
    ctaPlacement: text("cta_placement"),
    keyTakeaways: text("key_takeaways"),
    // Cached map-step distillation; the SOP reduce reads these instead of full transcripts.
    sopMapSummary: text("sop_map_summary"),
    verbatimFacts: jsonb("verbatim_facts").$type<VerbatimFact[]>(),
    chapters: jsonb("chapters").$type<Array<{ start_time: number; end_time: number; title: string }>>(),
    sponsorChapters: jsonb("sponsor_chapters").$type<Array<{ start_time: number; end_time: number; category: string; type: string }>>(),
    analyzedAt: timestamp("analyzed_at", { withTimezone: true }),
    runId: uuid("run_id").references(() => pipelineRuns.id, { onDelete: "set null" }),
  },
  (table) => ({
    channelVideoUnique: unique("clerk_videos_channel_video_unique").on(table.channelId, table.platformVideoId),
    // Owner-keyed twin of the channel unique; retires together with channel_id.
    ownerVideoUnique: unique("clerk_videos_owner_video_unique").on(table.ownAccountId, table.platformVideoId),
    // Partial: NULLs make the own-side uniques vacuous for competitor rows.
    competitorVideoUnique: uniqueIndex("clerk_videos_competitor_video_unique")
      .on(table.competitorAccountId, table.platformVideoId)
      .where(sql`${table.competitorAccountId} is not null`),
    competitorIdx: index("clerk_videos_competitor_idx")
      .on(table.competitorAccountId)
      .where(sql`${table.competitorAccountId} is not null`),
    channelIdx: index("clerk_videos_channel_id_idx").on(table.channelId),
    // Per-run settlement sums durations WHERE run_id on every analysis completion.
    runIdx: index("clerk_videos_run_id_idx").on(table.runId),
  })
);

export const sopTypeEnum = pgEnum("sop_type", ["human", "ai_reference", "hottest", "single_video"]);

export const clerkSops = pgTable(
  "clerk_sops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channelId: uuid("channel_id").references(() => channels.id, { onDelete: "cascade" }),
    ownAccountId: uuid("own_account_id").references(() => ownAccounts.id, { onDelete: "cascade" }),
    // cascade (not set null): SET NULL would strand rows in violation of the one-owner CHECK.
    competitorAccountId: uuid("competitor_account_id").references(() => competitorAccounts.id, { onDelete: "cascade" }),
    sopType: sopTypeEnum("sop_type").notNull(),
    // Set only for single_video SOPs; channel-level SOPs keep it NULL.
    videoId: uuid("video_id").references(() => clerkVideos.id, { onDelete: "set null" }),
    language: text("language").notNull().default("zh"),
    contentMd: text("content_md").notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    runId: uuid("run_id").references(() => pipelineRuns.id, { onDelete: "set null" }),
  },
  (table) => ({
    channelIdx: index("clerk_sops_channel_id_idx").on(table.channelId),
    competitorIdx: index("clerk_sops_competitor_idx")
      .on(table.competitorAccountId)
      .where(sql`${table.competitorAccountId} is not null`),
    // Re-running one video replaces its prior SOP per language; channel SOPs (video_id NULL) are ignored.
    singleVideoUnique: uniqueIndex("clerk_sops_single_video_unique")
      .on(table.videoId, table.language)
      .where(sql`${table.sopType} = 'single_video' AND ${table.videoId} is not null`),
  })
);

export type ClerkVideo = typeof clerkVideos.$inferSelect;
export type NewClerkVideo = typeof clerkVideos.$inferInsert;
export type ClerkSop = typeof clerkSops.$inferSelect;
export type NewClerkSop = typeof clerkSops.$inferInsert;
