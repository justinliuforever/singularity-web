import { index, integer, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { users } from "./users";

export const platformEnum = pgEnum("platform", ["youtube", "xhs", "douyin"]);

export const channels = pgTable(
  "channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    platform: platformEnum("platform").notNull(),
    platformUrl: text("platform_url").notNull(),
    platformChannelId: text("platform_channel_id"),
    description: text("description"),
    // Manually refreshed, not kept live by any job.
    subscriberCount: integer("subscriber_count"),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userSlugUnique: unique("channels_user_slug_unique").on(table.userId, table.slug),
    userIdx: index("channels_user_id_idx").on(table.userId),
  })
);

export type Channel = typeof channels.$inferSelect;
export type NewChannel = typeof channels.$inferInsert;
