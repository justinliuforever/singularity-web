import { and, desc, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { clerkSops } from "../schema/clerk";
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
    .where(and(eq(projectSops.projectId, projectId), eq(projectSops.role, "primary")))
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
