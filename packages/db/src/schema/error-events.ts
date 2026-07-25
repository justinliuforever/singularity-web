import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { users } from "./users";

// Fed by the Next.js instrumentation onRequestError hook; surfaced in the admin ops tab.
export const errorEvents = pgTable(
  "error_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    route: text("route"),
    method: text("method"),
    kind: text("kind"),
    message: text("message").notNull(),
    stack: text("stack"),
    digest: text("digest"),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
  },
  (table) => ({
    occurredAtIdx: index("error_events_occurred_at_idx").on(table.occurredAt),
  }),
);

export type ErrorEvent = typeof errorEvents.$inferSelect;
