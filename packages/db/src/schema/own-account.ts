import { index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { platformEnum } from "./channels";
import { users } from "./users";

export const ownAccounts = pgTable(
  "own_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    platform: platformEnum("platform").notNull(),
    platformUrl: text("platform_url").notNull(),
    platformChannelId: text("platform_channel_id"),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userSlugUnique: unique("own_accounts_user_slug_unique").on(table.userId, table.slug),
    userIdx: index("own_accounts_user_id_idx").on(table.userId),
  }),
);

export type OwnAccount = typeof ownAccounts.$inferSelect;
export type NewOwnAccount = typeof ownAccounts.$inferInsert;
