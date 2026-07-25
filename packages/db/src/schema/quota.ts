import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { users } from "./users";

// period = 'YYYY-MM' (Asia/Shanghai); bonus_minutes comes from redemption codes and expires with
// the row. contents_used/generations_used are dormant leftovers from the pre-minutes model.
export const usageCounters = pgTable(
  "usage_counters",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    period: text("period").notNull(),
    minutesUsed: integer("minutes_used").notNull().default(0),
    bonusMinutes: integer("bonus_minutes").notNull().default(0),
    contentsUsed: integer("contents_used").notNull().default(0),
    generationsUsed: integer("generations_used").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.period] }),
  }),
);

// access: redeeming flips users.accessStatus to approved (may combine with minutes).
export type CodeGrant = { minutes?: number; access?: boolean };

export const redemptionCodes = pgTable("redemption_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  grant: jsonb("grant").$type<CodeGrant>().notNull(),
  maxUses: integer("max_uses").notNull().default(1),
  usedCount: integer("used_count").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  note: text("note"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const codeRedemptions = pgTable(
  "code_redemptions",
  {
    codeId: uuid("code_id")
      .notNull()
      .references(() => redemptionCodes.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.codeId, table.userId] }),
  }),
);

export const quotaAdjustments = pgTable("quota_adjustments", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  source: text("source", { enum: ["code", "admin"] }).notNull(),
  codeId: uuid("code_id"),
  minutesDelta: integer("minutes_delta").notNull().default(0),
  accountsDelta: integer("accounts_delta").notNull().default(0),
  contentsDelta: integer("contents_delta").notNull().default(0),
  generationsDelta: integer("generations_delta").notNull().default(0),
  note: text("note"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// One row per completed Logto sign-in (callback route); admin user detail reads count + IP history.
export const loginEvents = pgTable(
  "login_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("login_events_user_idx").on(table.userId, table.createdAt),
  }),
);

export type RedemptionCode = typeof redemptionCodes.$inferSelect;
export type UsageCounter = typeof usageCounters.$inferSelect;
