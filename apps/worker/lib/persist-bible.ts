import { logger } from "@trigger.dev/sdk";
import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { poetBible, poetDriftEvents, projects, type ImportFlag } from "@goooose/db";
import type { DriftWarning } from "@goooose/domain/schemas/poet";

type PersistArgs = {
  channelId: string;
  name: string;
  content: string;
  sourceIdea?: string | null;
  sourceKind: "idea" | "file";
  sourceTranscript?: string | null;
  hostName?: string | null;
  importFileId?: string | null;
  importFlags?: ImportFlag[];
  driftWarning: DriftWarning | null;
  // Unresolved import flags park the bible for field-by-field review before activation.
  blockActivation?: boolean;
};

// Never clobbers an active bible: auto-activation happens only when none is active yet,
// and the project's hard pin is kept in sync with it.
export async function persistBible(db: PostgresJsDatabase, args: PersistArgs) {
  const [existingActive] = await db
    .select({ id: poetBible.id })
    .from(poetBible)
    .where(and(eq(poetBible.channelId, args.channelId), eq(poetBible.isActive, true)))
    .limit(1);
  const shouldActivate = !existingActive && !args.blockActivation;

  const [inserted] = await db
    .insert(poetBible)
    .values({
      channelId: args.channelId,
      ownAccountId: args.channelId,
      name: args.name,
      content: args.content,
      sourceIdea: args.sourceIdea ?? null,
      sourceKind: args.sourceKind,
      sourceTranscript: args.sourceTranscript ?? null,
      hostName: args.hostName ?? null,
      importFileId: args.importFileId ?? null,
      importFlags: args.importFlags ?? [],
      isActive: shouldActivate,
    })
    .returning();

  if (shouldActivate && inserted) {
    await db
      .update(projects)
      .set({ activeBibleId: inserted.id, updatedAt: new Date() })
      .where(eq(projects.id, args.channelId));
  }

  if (args.driftWarning && inserted) {
    await db.insert(poetDriftEvents).values({
      channelId: args.channelId,
      ownAccountId: args.channelId,
      bibleId: inserted.id,
      reason: args.driftWarning.reason,
      claimedTopic: args.driftWarning.claimedTopic,
      humanMessage: args.driftWarning.humanMessage,
    });
    logger.warn(`Bible drift: ${args.driftWarning.reason}`, { topic: args.driftWarning.claimedTopic });
  }

  return { inserted: inserted ?? null, activated: shouldActivate };
}
