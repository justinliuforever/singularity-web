import "server-only";

import { eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import { codeRedemptions, grantMinutes, quotaAdjustments, redemptionCodes, users } from "@goooose/db";

import { db } from "@/lib/db";
import { sendApprovalEmail } from "@/lib/email";

export const BETA_CODE_COOKIE = "goooose_beta_code";

// Per-IP sliding window; per-instance memory suffices — the 31^8 code space makes enumeration pointless.
const hits = new Map<string, number[]>();

export function rateLimitOk(key: string, limit = 10, windowMs = 600_000): boolean {
  const now = Date.now();
  if (hits.size > 1000) {
    for (const [k, v] of hits) if (v.every((t) => now - t >= windowMs)) hits.delete(k);
  }
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}

export type ValidateCodeResult = {
  valid: boolean;
  reason?: "not_found" | "not_access" | "expired" | "exhausted";
};

// Read-only check for the public landing entry — never consumes a use.
export async function validateAccessCode(rawCode: string): Promise<ValidateCodeResult> {
  const codeStr = rawCode.trim().toUpperCase();
  const [code] = await db
    .select()
    .from(redemptionCodes)
    .where(eq(redemptionCodes.code, codeStr))
    .limit(1);
  if (!code) return { valid: false, reason: "not_found" };
  if (!code.grant?.access) return { valid: false, reason: "not_access" };
  if (code.expiresAt && code.expiresAt < new Date()) return { valid: false, reason: "expired" };
  if (code.usedCount >= code.maxUses) return { valid: false, reason: "exhausted" };
  return { valid: true };
}

export type RedeemAccessResult = {
  approved: boolean;
  minutesGranted: number;
  alreadyApproved?: boolean;
  alreadyRedeemed?: boolean;
};

// Same lock + idempotency as access.redeem (trpc/access.ts) but callable by pending users.
export async function redeemAccessCode(
  user: { id: string; accessStatus: string; email: string | null },
  rawCode: string,
): Promise<RedeemAccessResult> {
  const codeStr = rawCode.trim().toUpperCase();
  if (user.accessStatus === "blocked") {
    throw new TRPCError({ code: "FORBIDDEN", message: "该账号访问已停用" });
  }
  const result = await db.transaction(async (tx) => {
    const [code] = await tx
      .select()
      .from(redemptionCodes)
      .where(eq(redemptionCodes.code, codeStr))
      .for("update")
      .limit(1);
    if (!code) throw new TRPCError({ code: "NOT_FOUND", message: "内测码不存在" });
    if (!code.grant?.access) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "这是时长兑换码，不是内测码 — 登录后在「用量与额度」页兑换",
      });
    }
    if (code.expiresAt && code.expiresAt < new Date()) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "内测码已过期" });
    }
    const minutes = code.grant.minutes ?? 0;
    // Already-approved user re-entering a pure access code: no-op, don't burn a use.
    if (user.accessStatus === "approved" && minutes <= 0) {
      return { approved: true, minutesGranted: 0, alreadyApproved: true };
    }
    if (code.usedCount >= code.maxUses) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "内测码已被用完" });
    }
    const inserted = await tx
      .insert(codeRedemptions)
      .values({ codeId: code.id, userId: user.id })
      .onConflictDoNothing()
      .returning();
    if (inserted.length === 0) {
      // Same user, same code again (login retry) — idempotent, don't burn a use.
      return { approved: user.accessStatus === "approved", minutesGranted: 0, alreadyRedeemed: true };
    }
    await tx
      .update(redemptionCodes)
      .set({ usedCount: sql`${redemptionCodes.usedCount} + 1` })
      .where(eq(redemptionCodes.id, code.id));
    let transitioned = false;
    if (user.accessStatus !== "approved") {
      await tx.update(users).set({ accessStatus: "approved" }).where(eq(users.id, user.id));
      transitioned = true;
    }
    if (minutes > 0) {
      await grantMinutes(tx, { userId: user.id, amount: minutes });
      await tx.insert(quotaAdjustments).values({
        userId: user.id,
        source: "code",
        codeId: code.id,
        minutesDelta: minutes,
        note: code.note,
      });
    }
    return { approved: true, minutesGranted: minutes, transitioned };
  });
  if ("transitioned" in result && result.transitioned && user.email) {
    // Outside the transaction — email failure must not roll back the approval.
    await sendApprovalEmail(user.email);
  }
  return {
    approved: result.approved,
    minutesGranted: result.minutesGranted,
    alreadyApproved: "alreadyApproved" in result ? result.alreadyApproved : undefined,
    alreadyRedeemed: "alreadyRedeemed" in result ? result.alreadyRedeemed : undefined,
  };
}
