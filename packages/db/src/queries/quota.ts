import { and, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { channels } from "../schema/channels";
import { competitorAccounts } from "../schema/competitor";
import { usageCounters } from "../schema/quota";
import { pipelineRuns } from "../schema/runs";
import { users } from "../schema/users";

// Structural: fits the bare worker client, the schema-typed web client and tx handles alike.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = Pick<PostgresJsDatabase<any>, "select" | "insert" | "update">;

// One monthly minutes pool shared by analysis and generation.
export const PLAN_LIMITS: Record<string, { minutesPerMonth: number; accountsMax: number }> = {
  free: { minutesPerMonth: 300, accountsMax: 30 },
};

export function planLimits(plan: string) {
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS.free!;
}

export const IMAGE_POST_MINUTES = 5;
export const GENERATION_MINUTES = { bible: 5, bibleImport: 10, topic: 3, singleVideo: 2 } as const;
// Re-ideating a video whose transcript is already cached: no fetch, no ASR, two LLM calls.
// Priced like a topic analysis, which is the same shape of work.
export const IDEATION_MINUTES = 3;

export function videoMinutes(durationSec?: number | null): number {
  if (!durationSec || durationSec <= 0) return IMAGE_POST_MINUTES;
  return Math.max(1, Math.ceil(durationSec / 60));
}

export function scriptMinutes(durationSec?: number | null): number {
  return Math.max(2, Math.ceil((durationSec ?? 300) / 60));
}

export function currentPeriod(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")!.value;
  const month = parts.find((p) => p.type === "month")!.value;
  return `${year}-${month}`;
}

export type MinutesSnapshot = {
  allowed: boolean;
  base: number;
  used: number;
  bonus: number;
  remaining: number;
};

export async function checkMinutes(
  db: AnyDb,
  args: { userId: string; need?: number },
): Promise<MinutesSnapshot> {
  const need = args.need ?? 1;
  const [user] = await db
    .select({ plan: users.plan })
    .from(users)
    .where(eq(users.id, args.userId))
    .limit(1);
  const base = planLimits(user?.plan ?? "free").minutesPerMonth;
  const [counter] = await db
    .select({ used: usageCounters.minutesUsed, bonus: usageCounters.bonusMinutes })
    .from(usageCounters)
    .where(and(eq(usageCounters.userId, args.userId), eq(usageCounters.period, currentPeriod())))
    .limit(1);
  const used = counter?.used ?? 0;
  const bonus = counter?.bonus ?? 0;
  const remaining = base + bonus - used;
  return { allowed: remaining >= need, base, used, bonus, remaining };
}

export async function consumeMinutes(
  db: AnyDb,
  args: { userId: string; amount: number },
): Promise<void> {
  if (args.amount <= 0) return;
  await db
    .insert(usageCounters)
    .values({ userId: args.userId, period: currentPeriod(), minutesUsed: args.amount })
    .onConflictDoUpdate({
      target: [usageCounters.userId, usageCounters.period],
      set: {
        minutesUsed: sql`${usageCounters.minutesUsed} + ${args.amount}`,
        updatedAt: new Date(),
      },
    });
}

// Charges the DELTA over what the row already carries, and claims the row BEFORE consuming:
// a failure between the two under-charges rather than leaving a charge no refund can find.
export async function settleRunMinutes(
  db: AnyDb,
  args: { runId: string; userId: string; minutes: number },
): Promise<number> {
  const [current] = await db
    .select({ charged: pipelineRuns.quotaCharged })
    .from(pipelineRuns)
    .where(eq(pipelineRuns.id, args.runId))
    .limit(1);
  const prev = current?.charged ?? 0;
  const delta = args.minutes - prev;
  if (delta <= 0) return 0;
  const [claimed] = await db
    .update(pipelineRuns)
    .set({ quotaCharged: args.minutes })
    .where(and(eq(pipelineRuns.id, args.runId), eq(pipelineRuns.quotaCharged, prev)))
    .returning({ id: pipelineRuns.id });
  if (!claimed) return 0;
  try {
    await consumeMinutes(db, { userId: args.userId, amount: delta });
  } catch (err) {
    // The row already says charged; leaving it would let a later refund return minutes never taken.
    await db
      .update(pipelineRuns)
      .set({ quotaCharged: prev })
      .where(eq(pipelineRuns.id, args.runId));
    throw err;
  }
  return delta;
}

// Code-granted minutes live on the current period row and expire with it.
export async function grantMinutes(
  db: AnyDb,
  args: { userId: string; amount: number },
): Promise<void> {
  if (args.amount <= 0) return;
  await db
    .insert(usageCounters)
    .values({ userId: args.userId, period: currentPeriod(), bonusMinutes: args.amount })
    .onConflictDoUpdate({
      target: [usageCounters.userId, usageCounters.period],
      set: {
        bonusMinutes: sql`${usageCounters.bonusMinutes} + ${args.amount}`,
        updatedAt: new Date(),
      },
    });
}

// Exactly once: the atomic quota_refunded flip keeps cancel / reaper / worker-catch race-safe.
// Refund lands in the current period floored at 0 — charge and refund are near-always same-month.
export async function refundRunQuota(db: AnyDb, runId: string): Promise<number> {
  const [row] = await db
    .update(pipelineRuns)
    .set({ quotaRefunded: true })
    .where(
      and(
        eq(pipelineRuns.id, runId),
        eq(pipelineRuns.quotaRefunded, false),
        gt(pipelineRuns.quotaCharged, 0),
        isNotNull(pipelineRuns.userId),
      ),
    )
    .returning({ userId: pipelineRuns.userId, charged: pipelineRuns.quotaCharged });
  if (!row?.userId || !row.charged) return 0;
  await db
    .insert(usageCounters)
    .values({ userId: row.userId, period: currentPeriod(), minutesUsed: 0 })
    .onConflictDoUpdate({
      target: [usageCounters.userId, usageCounters.period],
      set: {
        minutesUsed: sql`GREATEST(${usageCounters.minutesUsed} - ${row.charged}, 0)`,
        updatedAt: new Date(),
      },
    });
  return row.charged;
}

export async function countAccounts(db: AnyDb, userId: string): Promise<number> {
  const [own] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(channels)
    .where(eq(channels.userId, userId));
  const [comp] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(competitorAccounts)
    .where(and(eq(competitorAccounts.userId, userId), isNull(competitorAccounts.deletedAt)));
  return (own?.n ?? 0) + (comp?.n ?? 0);
}

// Hidden anti-abuse rail — not surfaced as a user-facing quota, only errors at the cap.
export async function checkAccountRail(
  db: AnyDb,
  userId: string,
): Promise<{ allowed: boolean; max: number; used: number }> {
  const [user] = await db
    .select({ plan: users.plan })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const max = planLimits(user?.plan ?? "free").accountsMax;
  const used = await countAccounts(db, userId);
  return { allowed: used < max, max, used };
}
