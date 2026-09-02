import { and, desc, eq, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { clerkSops } from "../schema/clerk";
import { competitorAccounts } from "../schema/competitor";
import { projectSops } from "../schema/project";

export type ResolvedSop = { id: string; contentMd: string };

// An unbound project falls back to the account's own-channel ai_reference SOP.
export async function resolvePrimarySop(
  db: PostgresJsDatabase,
  projectId: string,
  accountId: string,
): Promise<ResolvedSop | null> {
  const [bound] = await db
    .select({ id: clerkSops.id, contentMd: clerkSops.contentMd })
    .from(projectSops)
    .innerJoin(clerkSops, eq(clerkSops.id, projectSops.sopId))
    .leftJoin(competitorAccounts, eq(competitorAccounts.id, clerkSops.competitorAccountId))
    .where(
      and(
        eq(projectSops.projectId, projectId),
        eq(projectSops.role, "primary"),
        isNull(competitorAccounts.deletedAt),
      ),
    )
    .orderBy(desc(clerkSops.generatedAt), desc(clerkSops.id))
    .limit(1);
  if (bound) return bound;

  const [legacy] = await db
    .select({ id: clerkSops.id, contentMd: clerkSops.contentMd })
    .from(clerkSops)
    .where(and(eq(clerkSops.channelId, accountId), eq(clerkSops.sopType, "ai_reference")))
    .orderBy(desc(clerkSops.generatedAt), desc(clerkSops.id))
    .limit(1);
  return legacy ?? null;
}
