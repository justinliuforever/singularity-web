import { logger, runs, schedules } from "@trigger.dev/sdk";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { bibleImportFiles, errorEvents, pipelineRuns, proxySessions, refundRunQuota } from "@goooose/db";

function openDb() {
  const client = postgres(process.env.DATABASE_URL!, { prepare: false });
  return { client, db: drizzle(client) };
}

// A hard crash skips withRunDb's catch, leaving a run 'running' forever — it
// lingers in history/UI and never settles. Close pending never-started >30min
// (matches assertNoActiveRun's orphan cutoff) and running past the 4h maxDuration.
export const reapStuckRuns = schedules.task({
  id: "maint-reap-stuck-runs",
  cron: { pattern: "*/15 * * * *", environments: ["PRODUCTION"] },
  run: async () => {
    const { client, db } = openDb();
    try {
      const reaped = await db
        .update(pipelineRuns)
        .set({
          status: "failed",
          errorMessage: "任务超时未完成，已由维护任务清理",
          completedAt: new Date(),
        })
        .where(
          sql`(
            (${pipelineRuns.status} = 'pending' AND ${pipelineRuns.startedAt} < now() - interval '30 minutes')
            OR (${pipelineRuns.status} = 'running' AND ${pipelineRuns.startedAt} < now() - interval '5 hours')
          )`,
        )
        .returning({ id: pipelineRuns.id, configJson: pipelineRuns.configJson });
      for (const r of reaped) {
        await refundRunQuota(db, r.id).catch(() => {});
        // Written off in our DB but still queued on Trigger, it would hold a slot and then
        // deliver work the user was already refunded for.
        const triggerRunId = (r.configJson as { triggerRunId?: string } | null)?.triggerRunId;
        if (triggerRunId) await runs.cancel(triggerRunId).catch(() => {});
      }
      logger.info(`reaped ${reaped.length} stuck runs`);
      return { reaped: reaped.length };
    } finally {
      await client.end();
    }
  },
});

// Abandoned bible-import uploads hold bytea chunk rows; purge past their TTL
// (CASCADE drops the chunks). Consumed/invalid rows keep metadata but no bytes.
export const gcBibleImports = schedules.task({
  id: "maint-gc-bible-imports",
  cron: { pattern: "30 * * * *", environments: ["PRODUCTION"] },
  run: async () => {
    const { client, db } = openDb();
    try {
      // 'processing' leftovers are failed imports whose task never reached cleanup.
      const purged = await db
        .delete(bibleImportFiles)
        .where(
          sql`(
            (${bibleImportFiles.status} IN ('uploading','ready') AND ${bibleImportFiles.expiresAt} < now())
            OR (${bibleImportFiles.status} = 'processing' AND ${bibleImportFiles.createdAt} < now() - interval '24 hours')
          )`,
        )
        .returning({ id: bibleImportFiles.id });
      logger.info(`purged ${purged.length} expired bible import uploads`);
      return { purged: purged.length };
    } finally {
      await client.end();
    }
  },
});

// Keep the own-DB error log bounded — 30 days is plenty for post-incident triage.
export const gcErrorEvents = schedules.task({
  id: "maint-gc-error-events",
  cron: { pattern: "45 3 * * *", environments: ["PRODUCTION"] },
  run: async () => {
    const { client, db } = openDb();
    try {
      const purged = await db
        .delete(errorEvents)
        .where(sql`${errorEvents.occurredAt} < now() - interval '30 days'`)
        .returning({ id: errorEvents.id });
      logger.info(`purged ${purged.length} old error events`);
      return { purged: purged.length };
    } finally {
      await client.end();
    }
  },
});

// Proxy sessions are disabled on consecutive 403s but nothing re-enables them,
// so the YouTube-ASR pool erodes permanently. Give each another chance once its
// block has likely lifted (6h cooldown).
export const reenableProxySessions = schedules.task({
  id: "maint-reenable-proxy-sessions",
  cron: { pattern: "0 * * * *", environments: ["PRODUCTION"] },
  run: async () => {
    const { client, db } = openDb();
    try {
      const reenabled = await db
        .update(proxySessions)
        .set({ enabled: true, disabledAt: null, disabledReason: null })
        .where(
          and(
            eq(proxySessions.enabled, false),
            sql`${proxySessions.disabledAt} < now() - interval '6 hours'`,
          ),
        )
        .returning({ id: proxySessions.id });
      logger.info(`re-enabled ${reenabled.length} proxy sessions after cooldown`);
      return { reenabled: reenabled.length };
    } finally {
      await client.end();
    }
  },
});
