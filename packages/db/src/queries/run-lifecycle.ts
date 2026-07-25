import { eq } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { pipelineRuns } from "../schema";
import { refundRunQuota } from "./quota";

// The failed-status write must never drift between Trigger tasks — a lost errorMessage
// is an invisible failure.
export async function withRunDb<T>(
  runId: string,
  fn: (db: PostgresJsDatabase) => Promise<T>,
): Promise<T> {
  const client = postgres(process.env.DATABASE_URL!, { prepare: false });
  const db = drizzle(client);
  try {
    return await fn(db);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await db
        .update(pipelineRuns)
        .set({ status: "failed", errorMessage: message, completedAt: new Date() })
        .where(eq(pipelineRuns.id, runId));
      await refundRunQuota(db, runId);
    } catch {
      /* the original error matters more than the bookkeeping write */
    }
    throw err;
  } finally {
    await client.end();
  }
}
