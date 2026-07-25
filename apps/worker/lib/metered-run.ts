import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { createUsageBuffer, withRunDb } from "@goooose/db";
import { runWithUsage } from "@goooose/integrations/metering";

// Usage events flush in one insert before withRunDb closes the client; fire-and-forget races it.
export async function withMeteredRunDb<T>(
  args: { runId: string; userId?: string; feature: string },
  fn: (db: PostgresJsDatabase) => Promise<T>,
): Promise<T> {
  return withRunDb(args.runId, async (db) => {
    const buffer = createUsageBuffer();
    try {
      return await runWithUsage(
        { userId: args.userId, runId: args.runId, feature: args.feature, sink: buffer.push },
        () => fn(db),
      );
    } finally {
      await buffer.flush(db).catch((err) => console.error("usage flush failed", err));
    }
  });
}
