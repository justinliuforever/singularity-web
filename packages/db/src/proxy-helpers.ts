import { and, eq, inArray, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { ProxyPool, type ProxySession } from "@goooose/integrations/proxy";

import { proxySessions } from "./schema/proxy";

export async function loadProxyPool(
  db: PostgresJsDatabase,
  opts: { provider?: string } = {},
): Promise<ProxyPool> {
  const where = opts.provider
    ? and(eq(proxySessions.provider, opts.provider), eq(proxySessions.enabled, true))
    : eq(proxySessions.enabled, true);

  const rows = await db.select().from(proxySessions).where(where);

  const sessions: ProxySession[] = rows.map((r) => ({
    id: r.id,
    provider: r.provider,
    url: `http://${r.username}:${r.password}@${r.host}:${r.port}`,
    geo: r.geo,
  }));

  return new ProxyPool(sessions);
}

export async function flushProxyPool(
  db: PostgresJsDatabase,
  pool: ProxyPool,
): Promise<{ updatedSessions: number; newlyDisabled: number }> {
  const outcomes = pool.flush();
  if (outcomes.size === 0) return { updatedSessions: 0, newlyDisabled: 0 };

  let newlyDisabled = 0;
  const now = new Date();

  // Drizzle has no bulk-update-by-row-id; loop is acceptable (~230ms/session at task end).
  for (const [id, o] of outcomes.entries()) {
    const setExpr: Record<string, unknown> = {
      totalOk: sql`${proxySessions.totalOk} + ${o.okDelta}`,
      totalErr: sql`${proxySessions.totalErr} + ${o.errDelta}`,
      totalBytes: sql`${proxySessions.totalBytes} + ${o.bytesDelta}`,
      lastUsedAt: now,
    };
    if (o.lastError) setExpr.lastError = o.lastError;
    if (o.newlyDisabled) {
      setExpr.enabled = false;
      setExpr.disabledAt = now;
      setExpr.disabledReason = o.disabledReason;
      newlyDisabled++;
    }
    await db.update(proxySessions).set(setExpr).where(eq(proxySessions.id, id));
  }
  return { updatedSessions: outcomes.size, newlyDisabled };
}

export async function reenableSessions(
  db: PostgresJsDatabase,
  ids: string[],
): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await db
    .update(proxySessions)
    .set({ enabled: true, disabledAt: null, disabledReason: null })
    .where(inArray(proxySessions.id, ids));
  return (result as unknown as { count?: number }).count ?? ids.length;
}
