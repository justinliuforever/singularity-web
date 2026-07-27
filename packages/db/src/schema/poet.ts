import { sql } from "drizzle-orm";
import { boolean, check, customType, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { channels } from "./channels";
import { clerkSops } from "./clerk";
import { museIdeas } from "./muse";
import { ownAccounts } from "./own-account";
import { projects } from "./project";
import { pipelineRuns } from "./runs";
import { users } from "./users";

export const languageEnum = pgEnum("language", ["zh", "en"]);

const bytea = customType<{ data: Uint8Array }>({ dataType: () => "bytea" });

export type ImportFlag = {
  type: "illegible" | "truncated" | "audit" | "image_failed";
  detail: string;
  context?: string;
  resolved?: boolean;
};

export const bibleImportFiles = pgTable(
  "bible_import_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    sha256: text("sha256").notNull(),
    expectedChunks: integer("expected_chunks").notNull(),
    status: text("status", { enum: ["uploading", "ready", "processing", "consumed", "invalid", "expired"] })
      .notNull()
      .default("uploading"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '2 hours'`),
  },
  (table) => ({
    userIdx: index("bible_import_files_user_idx").on(table.userId, table.createdAt),
  }),
);

export const bibleImportChunks = pgTable(
  "bible_import_chunks",
  {
    fileId: uuid("file_id").notNull().references(() => bibleImportFiles.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),
    bytes: bytea("bytes").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.fileId, table.idx] }),
  }),
);

export const poetBible = pgTable(
  "poet_bible",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channelId: uuid("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    ownAccountId: uuid("own_account_id").notNull().references(() => ownAccounts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    content: text("content").notNull(),
    sourceIdea: text("source_idea"),
    sourceKind: text("source_kind", { enum: ["idea", "file"] }).notNull().default("idea"),
    sourceTranscript: text("source_transcript"),
    hostName: text("host_name"),
    importFileId: uuid("import_file_id").references(() => bibleImportFiles.id, { onDelete: "set null" }),
    importFlags: jsonb("import_flags").$type<ImportFlag[]>().notNull().default([]),
    isActive: boolean("is_active").notNull().default(true),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Hard-guarantee a single active bible per channel (consumers do where(isActive).limit(1)).
    oneActivePerChannel: uniqueIndex("poet_bible_one_active_per_channel")
      .on(table.channelId)
      .where(sql`${table.isActive}`),
  }),
);

export const driftReasonEnum = pgEnum("drift_reason", ["no_overlap", "ai_markers", "topic_substitution"]);

export const poetDriftEvents = pgTable("poet_drift_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  channelId: uuid("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  ownAccountId: uuid("own_account_id").notNull().references(() => ownAccounts.id, { onDelete: "cascade" }),
  bibleId: uuid("bible_id").references(() => poetBible.id, { onDelete: "set null" }),
  reason: driftReasonEnum("reason").notNull(),
  claimedTopic: text("claimed_topic"),
  humanMessage: text("human_message"),
  detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CustomTopicReference = {
  kind: "youtube" | "xhs" | "douyin" | "text";
  url?: string;
  text?: string;
  title?: string;
};

// Per-fact verification produced at topic-analysis time. status="disputed" means the
// fact conflicts with well-known reality even though a source cites it (e.g. a wrong
// product year); note carries the suggested correct value. We mark, never auto-edit.
export type CheckedFact = {
  fact: string;
  src: string;
  status: "verified" | "disputed" | "unsupported";
  note?: string;
};

export const customTopicStatusEnum = pgEnum("custom_topic_status", [
  "draft",
  "analyzed",
  "scripted",
]);

export const poetCustomTopics = pgTable("poet_custom_topics", {
  id: uuid("id").primaryKey().defaultRandom(),
  channelId: uuid("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  topic: text("topic").notNull(),
  references: jsonb("references").$type<CustomTopicReference[]>().default([]).notNull(),
  storyAngle: text("story_angle"),
  factsAndData: text("facts_and_data"),
  verbatimFacts: text("verbatim_facts"),
  factChecks: jsonb("fact_checks").$type<CheckedFact[]>().default([]).notNull(),
  whySimilar: text("why_similar"),
  viralTrigger: text("viral_trigger"),
  status: customTopicStatusEnum("status").notNull().default("draft"),
  bibleId: uuid("bible_id").references(() => poetBible.id, { onDelete: "set null" }),
  sopId: uuid("sop_id").references(() => clerkSops.id, { onDelete: "set null" }),
  // Provenance + dedup for ideas imported from Muse. Plain uuid (no FK) — idea rows may be deleted independently.
  sourceIdeaId: uuid("source_idea_id"),
  language: languageEnum("language").notNull().default("zh"),
  durationSeconds: integer("duration_seconds"),
  targetWordCount: integer("target_word_count"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const poetScripts = pgTable(
  "poet_scripts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channelId: uuid("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    ideaId: uuid("idea_id").references(() => museIdeas.id, { onDelete: "set null" }),
    customTopicId: uuid("custom_topic_id").references(() => poetCustomTopics.id, { onDelete: "set null" }),
    bibleId: uuid("bible_id").references(() => poetBible.id, { onDelete: "set null" }),
    sopId: uuid("sop_id").references(() => clerkSops.id, { onDelete: "set null" }),
    // User-set script name; NULL falls back to the source topic title at display time.
    name: text("name"),
    scriptText: text("script_text").notNull(),
    language: languageEnum("language").notNull(),
    wordCount: integer("word_count"),
    durationSeconds: integer("duration_seconds"),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    runId: uuid("run_id").references(() => pipelineRuns.id, { onDelete: "set null" }),
  },
  (table) => ({
    exactlyOneSource: check(
      "poet_scripts_exactly_one_source",
      sql`(${table.ideaId} IS NULL) <> (${table.customTopicId} IS NULL)`,
    ),
    channelIdx: index("poet_scripts_channel_id_idx").on(table.channelId),
  })
);

export type PoetBible = typeof poetBible.$inferSelect;
export type NewPoetBible = typeof poetBible.$inferInsert;
export type PoetDriftEvent = typeof poetDriftEvents.$inferSelect;
export type NewPoetDriftEvent = typeof poetDriftEvents.$inferInsert;
export type PoetCustomTopic = typeof poetCustomTopics.$inferSelect;
export type NewPoetCustomTopic = typeof poetCustomTopics.$inferInsert;
export type PoetScript = typeof poetScripts.$inferSelect;
export type NewPoetScript = typeof poetScripts.$inferInsert;
