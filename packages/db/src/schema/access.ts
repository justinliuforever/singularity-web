import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { users } from "./users";

// Pre-approval by email: matching login is auto-approved (lowercase-normalized).
export const allowedEmails = pgTable("allowed_emails", {
  email: text("email").primaryKey(),
  note: text("note"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const accessRequests = pgTable("access_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  message: text("message").notNull(),
  contact: text("contact"),
  status: text("status", { enum: ["pending", "approved", "rejected"] })
    .notNull()
    .default("pending"),
  decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Public beta survey (/apply): no login, so no users FK — email is the natural key.
// answers = {questionId: answer}; the question set lives in the web app, versioned by surveyVersion.
export type BetaAnswers = Record<string, string | string[]>;

export const betaApplications = pgTable("beta_applications", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  wechat: text("wechat"),
  social: text("social"),
  answers: jsonb("answers").$type<BetaAnswers>().notNull(),
  surveyVersion: integer("survey_version").notNull().default(1),
  // Ops funnel only — real access state lives on users.accessStatus.
  status: text("status", { enum: ["new", "contacted", "invited"] })
    .notNull()
    .default("new"),
  note: text("note"),
  ip: text("ip"),
  submitCount: integer("submit_count").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AllowedEmail = typeof allowedEmails.$inferSelect;
export type AccessRequest = typeof accessRequests.$inferSelect;
export type BetaApplication = typeof betaApplications.$inferSelect;
