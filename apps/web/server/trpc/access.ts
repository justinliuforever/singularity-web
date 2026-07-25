import "server-only";

import { randomBytes } from "node:crypto";

import { and, desc, eq, ne, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  accessRequests,
  allowedEmails,
  betaApplications,
  checkMinutes,
  codeRedemptions,
  currentPeriod,
  errorEvents,
  grantMinutes,
  loginEvents,
  pipelineRuns,
  quotaAdjustments,
  redemptionCodes,
  usageCounters,
  usageEvents,
  users,
} from "@goooose/db";

import { EMAIL_RE } from "@/lib/beta-survey";
import { db } from "@/lib/db";
import { APP_VERSION } from "@/lib/version";
import { sendApprovalEmail } from "@/lib/email";
import { rateLimitOk, redeemAccessCode, validateAccessCode } from "@/server/access-code";
import { adminProcedure, authedProcedure, protectedProcedure, publicProcedure, router } from "./init";

// No 0/O/1/I — codes get read over WeChat voice messages.
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function generateCode(): string {
  const bytes = randomBytes(8);
  const chars = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]);
  return `GOOSE-${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

// Only a real pending→approved transition mails, so every approval path notifies exactly once.
async function emailIfApproved(transitioned: boolean, userId: string) {
  if (!transitioned) return { emailSent: false, emailSkipReason: "already_approved" };
  const [u] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const r = await sendApprovalEmail(u?.email ?? "");
  return { emailSent: r.sent, emailSkipReason: r.reason };
}

export const accessRouter = router({
  // Server stamps its own APP_VERSION so "seen" always matches what was actually shown.
  markVersionSeen: authedProcedure.mutation(async ({ ctx }) => {
    await db
      .update(users)
      .set({ lastSeenVersion: APP_VERSION })
      .where(eq(users.id, ctx.user.id));
    return { ok: true };
  }),

  status: authedProcedure.query(async ({ ctx }) => {
    const [latest] = await db
      .select({
        status: accessRequests.status,
        createdAt: accessRequests.createdAt,
      })
      .from(accessRequests)
      .where(eq(accessRequests.userId, ctx.user.id))
      .orderBy(desc(accessRequests.createdAt))
      .limit(1);
    return {
      accessStatus: ctx.user.accessStatus,
      latestRequest: latest ?? null,
    };
  }),

  submit: authedProcedure
    .input(
      z.object({
        message: z.string().trim().min(2, "请简单介绍一下使用场景").max(2000),
        contact: z.string().trim().max(200).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.accessStatus === "approved") {
        return { status: "approved" as const };
      }
      if (ctx.user.accessStatus === "blocked") {
        throw new TRPCError({ code: "FORBIDDEN", message: "该账号访问已停用" });
      }
      const [pending] = await db
        .select({ id: accessRequests.id })
        .from(accessRequests)
        .where(eq(accessRequests.userId, ctx.user.id))
        .orderBy(desc(accessRequests.createdAt))
        .limit(1);
      if (pending) {
        await db
          .update(accessRequests)
          .set({ message: input.message, contact: input.contact ?? null, status: "pending" })
          .where(eq(accessRequests.id, pending.id));
      } else {
        await db.insert(accessRequests).values({
          userId: ctx.user.id,
          message: input.message,
          contact: input.contact ?? null,
        });
      }
      return { status: "pending" as const };
    }),

  myUsage: protectedProcedure.query(async ({ ctx }) => {
    const minutes = await checkMinutes(db, { userId: ctx.user.id });
    return {
      plan: ctx.user.plan ?? "free",
      minutes: { used: minutes.used, base: minutes.base, bonus: minutes.bonus },
    };
  }),

  // Upsert by email: one row per person, resubmits overwrite answers but never reset the ops status.
  submitBetaApplication: publicProcedure
    .input(
      z.object({
        // .regex over .email: tRPC puts the raw zod issue in error.message, which /apply renders inline.
        email: z.string().trim().toLowerCase().regex(EMAIL_RE, "请填写正确的邮箱地址").max(200),
        wechat: z.string().trim().max(100).optional(),
        social: z.string().trim().max(200).optional(),
        answers: z
          .record(
            z.string().max(64),
            z.union([z.string().max(2000), z.array(z.string().max(200)).max(20)]),
          )
          .refine((o) => Object.keys(o).length <= 30, "答案过多"),
        surveyVersion: z.number().int().min(1).max(100),
        // Honeypot — visually hidden field; bots fill it, humans never see it.
        website: z.string().max(200).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.website) return { ok: true };
      if (ctx.ip && !rateLimitOk(`beta-apply:${ctx.ip}`, 5)) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "提交过于频繁，请稍后再试" });
      }
      try {
        await db
          .insert(betaApplications)
          .values({
            email: input.email,
            wechat: input.wechat || null,
            social: input.social || null,
            answers: input.answers,
            surveyVersion: input.surveyVersion,
            ip: ctx.ip,
          })
          .onConflictDoUpdate({
            target: betaApplications.email,
            set: {
              // The stepper never prefills, so a blank resubmit would wipe the only non-email contact.
              wechat: sql`coalesce(${input.wechat || null}, ${betaApplications.wechat})`,
              social: sql`coalesce(${input.social || null}, ${betaApplications.social})`,
              answers: input.answers,
              surveyVersion: input.surveyVersion,
              ip: ctx.ip,
              submitCount: sql`${betaApplications.submitCount} + 1`,
              updatedAt: new Date(),
            },
          });
      } catch (err) {
        // Public endpoint — never leak SQL details to visitors.
        console.error("beta application insert failed", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "提交失败，请稍后再试",
        });
      }
      return { ok: true };
    }),

  validateBetaCode: publicProcedure
    .input(z.object({ code: z.string().trim().toUpperCase().min(4).max(32) }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.ip && !rateLimitOk(`beta-validate:${ctx.ip}`)) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "尝试过于频繁，请稍后再试" });
      }
      return validateAccessCode(input.code);
    }),

  // Authed (NOT protected): pending users are exactly who redeems an invite code.
  redeemBetaCode: authedProcedure
    .input(z.object({ code: z.string().trim().toUpperCase().min(4).max(32) }))
    .mutation(async ({ ctx, input }) => {
      return redeemAccessCode(ctx.user, input.code);
    }),

  redeem: protectedProcedure
    .input(z.object({ code: z.string().trim().toUpperCase().min(6).max(32) }))
    .mutation(async ({ ctx, input }) => {
      return db.transaction(async (tx) => {
        const [code] = await tx
          .select()
          .from(redemptionCodes)
          .where(eq(redemptionCodes.code, input.code))
          .for("update")
          .limit(1);
        if (!code) throw new TRPCError({ code: "NOT_FOUND", message: "兑换码不存在" });
        if (code.expiresAt && code.expiresAt < new Date()) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "兑换码已过期" });
        }
        if (code.usedCount >= code.maxUses) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "兑换码已被用完" });
        }
        const inserted = await tx
          .insert(codeRedemptions)
          .values({ codeId: code.id, userId: ctx.user.id })
          .onConflictDoNothing()
          .returning();
        if (inserted.length === 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "你已兑换过这个码" });
        }
        await tx
          .update(redemptionCodes)
          .set({ usedCount: sql`${redemptionCodes.usedCount} + 1` })
          .where(eq(redemptionCodes.id, code.id));
        const minutes = code.grant?.minutes ?? 0;
        if (minutes <= 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "兑换码额度无效" });
        }
        await grantMinutes(tx, { userId: ctx.user.id, amount: minutes });
        await tx.insert(quotaAdjustments).values({
          userId: ctx.user.id,
          source: "code",
          codeId: code.id,
          minutesDelta: minutes,
          note: code.note,
        });
        return { minutes };
      });
    }),
});

export const adminRouter = router({
  listRequests: adminProcedure.query(async () => {
    return db
      .select({
        id: accessRequests.id,
        message: accessRequests.message,
        contact: accessRequests.contact,
        status: accessRequests.status,
        createdAt: accessRequests.createdAt,
        decidedAt: accessRequests.decidedAt,
        userId: users.id,
        email: users.email,
        displayName: users.displayName,
      })
      .from(accessRequests)
      .innerJoin(users, eq(users.id, accessRequests.userId))
      // Filter on the user, not the request: other approval paths never touch access_requests.
      .where(eq(users.accessStatus, "pending"))
      .orderBy(desc(accessRequests.createdAt));
  }),

  decideRequest: adminProcedure
    .input(
      z.object({
        requestId: z.string().uuid(),
        decision: z.enum(["approve", "reject"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [request] = await db
        .select({ userId: accessRequests.userId })
        .from(accessRequests)
        .where(eq(accessRequests.id, input.requestId))
        .limit(1);
      if (!request) throw new TRPCError({ code: "NOT_FOUND" });
      const [beforeUser] = await db
        .select({ status: users.accessStatus })
        .from(users)
        .where(eq(users.id, request.userId))
        .limit(1);

      const nextStatus = input.decision === "approve" ? "approved" : "rejected";
      await db.transaction(async (tx) => {
        await tx
          .update(accessRequests)
          .set({ status: nextStatus, decidedBy: ctx.user.id, decidedAt: new Date() })
          .where(eq(accessRequests.id, input.requestId));
        if (input.decision === "approve") {
          await tx
            .update(users)
            .set({ accessStatus: "approved" })
            .where(eq(users.id, request.userId));
        }
      });

      if (input.decision !== "approve") return { emailSent: false };
      return emailIfApproved(beforeUser?.status !== "approved", request.userId);
    }),

  listBetaApplications: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(500).default(100), offset: z.number().int().min(0).default(0) }).optional())
    .query(async ({ input }) => {
      const limit = input?.limit ?? 100;
      const offset = input?.offset ?? 0;
      const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(betaApplications);
      const rows = await db
        .select()
        .from(betaApplications)
        .orderBy(
          sql`case when ${betaApplications.status} = 'new' then 0 else 1 end`,
          desc(betaApplications.updatedAt),
        )
        .limit(limit)
        .offset(offset);
      return { rows, total: count ?? 0, offset, limit };
    }),

  updateBetaApplication: adminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        status: z.enum(["new", "contacted", "invited"]),
        note: z.string().trim().max(200).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const updated = await db
        .update(betaApplications)
        .set({
          status: input.status,
          ...(input.note !== undefined ? { note: input.note || null } : {}),
          updatedAt: new Date(),
        })
        .where(eq(betaApplications.id, input.id))
        .returning({ id: betaApplications.id });
      if (updated.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "申请不存在" });
      return { ok: true };
    }),

  // One transaction: a failed status write leaves a live code nobody points at, and the retry mints a second.
  inviteBetaApplicationByCode: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return db.transaction(async (tx) => {
        const [app] = await tx
          .select()
          .from(betaApplications)
          .where(eq(betaApplications.id, input.id))
          .limit(1);
        if (!app) throw new TRPCError({ code: "NOT_FOUND", message: "申请不存在" });
        if (app.status === "invited") {
          throw new TRPCError({ code: "CONFLICT", message: "该申请已发码" });
        }
        const [created] = await tx
          .insert(redemptionCodes)
          .values({
            code: generateCode(),
            grant: { access: true },
            maxUses: 1,
            // Emails run to 200 chars, which alone overflows the note column's cap.
            note: `问卷邀请 ${app.email}`.slice(0, 200),
            createdBy: ctx.user.id,
          })
          .returning();
        const marked = await tx
          .update(betaApplications)
          .set({ status: "invited", updatedAt: new Date() })
          .where(and(eq(betaApplications.id, input.id), ne(betaApplications.status, "invited")))
          .returning({ id: betaApplications.id });
        if (marked.length === 0) throw new TRPCError({ code: "CONFLICT", message: "该申请已发码" });
        return { code: created!.code, email: app.email };
      });
    }),

  listAllowedEmails: adminProcedure.query(async () => {
    return db.select().from(allowedEmails).orderBy(desc(allowedEmails.createdAt));
  }),

  addAllowedEmail: adminProcedure
    .input(
      z.object({
        email: z.string().trim().toLowerCase().email(),
        note: z.string().trim().max(200).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await db
        .insert(allowedEmails)
        .values({ email: input.email, note: input.note ?? null, createdBy: ctx.user.id })
        .onConflictDoNothing();
      // Invitee may have already logged in and be waiting — approve + notify in place.
      const matched = await db
        .select({ id: users.id, status: users.accessStatus })
        .from(users)
        .where(sql`lower(${users.email}) = ${input.email}`);
      let approved = 0;
      for (const m of matched) {
        if (m.status === "approved") continue;
        await db.update(users).set({ accessStatus: "approved" }).where(eq(users.id, m.id));
        await emailIfApproved(true, m.id);
        approved++;
      }
      return { ok: true, approved };
    }),

  removeAllowedEmail: adminProcedure
    .input(z.object({ email: z.string().trim().toLowerCase().email() }))
    .mutation(async ({ input }) => {
      await db.delete(allowedEmails).where(eq(allowedEmails.email, input.email));
      return { ok: true };
    }),

  listUsers: adminProcedure.query(async () => {
    return db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        accessStatus: users.accessStatus,
        role: users.role,
        plan: users.plan,
        createdAt: users.createdAt,
        lastSeenAt: users.lastSeenAt,
        lastSeenVersion: users.lastSeenVersion,
        minutesUsed: sql<number>`coalesce(${usageCounters.minutesUsed}, 0)`,
        bonusMinutes: sql<number>`coalesce(${usageCounters.bonusMinutes}, 0)`,
      })
      .from(users)
      .leftJoin(
        usageCounters,
        and(eq(usageCounters.userId, users.id), eq(usageCounters.period, currentPeriod())),
      )
      .orderBy(
        sql`case when ${users.accessStatus} = 'pending' then 0 else 1 end`,
        desc(users.createdAt),
      );
  }),

  createCode: adminProcedure
    .input(
      z
        .object({
          minutes: z.number().int().min(1).max(100000).optional(),
          access: z.boolean().default(false),
          maxUses: z.number().int().min(1).max(1000).default(1),
          expiresInDays: z.number().int().min(1).max(365).optional(),
          note: z.string().trim().max(200).optional(),
        })
        .refine((v) => v.access || (v.minutes ?? 0) > 0, {
          message: "码至少要含准入或时长",
          path: ["minutes"],
        }),
    )
    .mutation(async ({ ctx, input }) => {
      const [created] = await db
        .insert(redemptionCodes)
        .values({
          code: generateCode(),
          grant: {
            ...(input.minutes ? { minutes: input.minutes } : {}),
            ...(input.access ? { access: true } : {}),
          },
          maxUses: input.maxUses,
          expiresAt: input.expiresInDays
            ? new Date(Date.now() + input.expiresInDays * 86400_000)
            : null,
          note: input.note ?? null,
          createdBy: ctx.user.id,
        })
        .returning();
      return created!;
    }),

  listCodes: adminProcedure.query(async () => {
    return db
      .select({
        id: redemptionCodes.id,
        code: redemptionCodes.code,
        grant: redemptionCodes.grant,
        maxUses: redemptionCodes.maxUses,
        usedCount: redemptionCodes.usedCount,
        expiresAt: redemptionCodes.expiresAt,
        note: redemptionCodes.note,
        createdAt: redemptionCodes.createdAt,
        redeemers: sql<Array<{ email: string; redeemedAt: string }>>`coalesce((
          select json_agg(json_build_object('email', u.email, 'redeemedAt', cr.redeemed_at) order by cr.redeemed_at)
          from code_redemptions cr join users u on u.id = cr.user_id
          where cr.code_id = ${redemptionCodes.id}
        ), '[]'::json)`,
      })
      .from(redemptionCodes)
      .orderBy(desc(redemptionCodes.createdAt))
      .limit(100);
  }),

  disableCode: adminProcedure
    .input(z.object({ codeId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      await db
        .update(redemptionCodes)
        .set({ expiresAt: new Date() })
        .where(eq(redemptionCodes.id, input.codeId));
      return { ok: true };
    }),

  usageSummary: adminProcedure.query(async () => {
    const month = sql<string>`to_char(${usageEvents.createdAt} at time zone 'Asia/Shanghai', 'YYYY-MM')`;
    return db
      .select({
        userId: usageEvents.userId,
        email: users.email,
        month,
        llmTokens: sql<number>`coalesce(sum(${usageEvents.inputTokens}), 0) + coalesce(sum(${usageEvents.outputTokens}), 0)`,
        asrSeconds: sql<number>`coalesce(sum(${usageEvents.audioSeconds}), 0)`,
        scrapeCalls: sql<number>`coalesce(sum(${usageEvents.apiCalls}) filter (where ${usageEvents.resourceType} = 'scrape'), 0)`,
        costUsd: sql<number>`coalesce(sum(${usageEvents.estimatedCostUsd}), 0)`,
      })
      .from(usageEvents)
      .innerJoin(users, eq(users.id, usageEvents.userId))
      .groupBy(usageEvents.userId, users.email, month)
      .orderBy(desc(month), desc(sql`sum(${usageEvents.estimatedCostUsd})`));
  }),

  // The 30-minute stuck threshold must stay in step with the reaper cron.
  listRuns: adminProcedure
    .input(z.object({ status: z.enum(["all", "active", "failed", "stuck"]).default("all"), limit: z.number().int().min(1).max(200).default(60) }).optional())
    .query(async ({ input }) => {
      const filter = input?.status ?? "all";
      const limit = input?.limit ?? 60;
      const stuckBefore = sql`now() - interval '30 minutes'`;
      const cond =
        filter === "active"
          ? sql`${pipelineRuns.status} in ('pending','running')`
          : filter === "failed"
            ? sql`${pipelineRuns.status} = 'failed'`
            : filter === "stuck"
              ? sql`${pipelineRuns.status} in ('pending','running') and ${pipelineRuns.startedAt} < ${stuckBefore}`
              : sql`true`;
      const rows = await db
        .select({
          id: pipelineRuns.id,
          agent: pipelineRuns.agent,
          command: pipelineRuns.command,
          status: pipelineRuns.status,
          progress: pipelineRuns.progress,
          total: pipelineRuns.total,
          quotaCharged: pipelineRuns.quotaCharged,
          quotaRefunded: pipelineRuns.quotaRefunded,
          startedAt: pipelineRuns.startedAt,
          completedAt: pipelineRuns.completedAt,
          errorMessage: pipelineRuns.errorMessage,
          email: users.email,
          stuck: sql<boolean>`${pipelineRuns.status} in ('pending','running') and ${pipelineRuns.startedAt} < ${stuckBefore}`,
        })
        .from(pipelineRuns)
        .leftJoin(users, eq(users.id, pipelineRuns.userId))
        .where(cond)
        .orderBy(desc(pipelineRuns.startedAt))
        .limit(limit);
      const [counts] = await db
        .select({
          active: sql<number>`count(*) filter (where ${pipelineRuns.status} in ('pending','running'))::int`,
          stuck: sql<number>`count(*) filter (where ${pipelineRuns.status} in ('pending','running') and ${pipelineRuns.startedAt} < ${stuckBefore})::int`,
          failed24h: sql<number>`count(*) filter (where ${pipelineRuns.status} = 'failed' and ${pipelineRuns.startedAt} > now() - interval '24 hours')::int`,
        })
        .from(pipelineRuns);
      return { rows, counts: counts ?? { active: 0, stuck: 0, failed24h: 0 } };
    }),

  listErrors: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(60) }).optional())
    .query(async ({ input }) => {
      const limit = input?.limit ?? 60;
      // instrumentation onRequestError has no session, so email is present only on tRPC-captured rows.
      const rows = await db
        .select({
          id: errorEvents.id,
          occurredAt: errorEvents.occurredAt,
          route: errorEvents.route,
          method: errorEvents.method,
          kind: errorEvents.kind,
          message: errorEvents.message,
          stack: errorEvents.stack,
          email: users.email,
        })
        .from(errorEvents)
        .leftJoin(users, eq(users.id, errorEvents.userId))
        .orderBy(desc(errorEvents.occurredAt))
        .limit(limit);
      const [counts] = await db
        .select({
          last24h: sql<number>`count(*) filter (where ${errorEvents.occurredAt} > now() - interval '24 hours')::int`,
          last7d: sql<number>`count(*) filter (where ${errorEvents.occurredAt} > now() - interval '7 days')::int`,
        })
        .from(errorEvents);
      return { rows, counts: counts ?? { last24h: 0, last7d: 0 } };
    }),

  setUserAccess: adminProcedure
    .input(
      z.object({
        userId: z.string().uuid(),
        accessStatus: z.enum(["pending", "approved", "blocked"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "不能修改自己的访问状态" });
      }
      const [before] = await db
        .select({ status: users.accessStatus })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);
      await db
        .update(users)
        .set({ accessStatus: input.accessStatus })
        .where(eq(users.id, input.userId));
      if (input.accessStatus === "approved") {
        return emailIfApproved(before?.status !== "approved", input.userId);
      }
      return { emailSent: false };
    }),

  setUserRole: adminProcedure
    .input(
      z.object({
        userId: z.string().uuid(),
        role: z.enum(["member", "admin"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "不能修改自己的角色" });
      }
      await db.update(users).set({ role: input.role }).where(eq(users.id, input.userId));
      return { ok: true };
    }),

  deleteUser: adminProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "不能删除自己" });
      }
      // FK cascades wipe channels/projects/runs; usage_events rows survive with user_id nulled.
      await db.delete(users).where(eq(users.id, input.userId));
      return { ok: true };
    }),

  userDetail: adminProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .query(async ({ input }) => {
      const [user] = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
      if (!user) throw new TRPCError({ code: "NOT_FOUND" });
      const month = sql<string>`to_char(${usageEvents.createdAt} at time zone 'Asia/Shanghai', 'YYYY-MM')`;
      const [usageByMonth, logins, [loginStats], [runStats], [latestRequest]] = await Promise.all([
        db
          .select({
            month,
            llmInputTokens: sql<number>`coalesce(sum(${usageEvents.inputTokens}), 0)`,
            llmOutputTokens: sql<number>`coalesce(sum(${usageEvents.outputTokens}), 0)`,
            asrSeconds: sql<number>`coalesce(sum(${usageEvents.audioSeconds}), 0)`,
            scrapeCalls: sql<number>`coalesce(sum(${usageEvents.apiCalls}) filter (where ${usageEvents.resourceType} = 'scrape'), 0)`,
            costUsd: sql<number>`coalesce(sum(${usageEvents.estimatedCostUsd}), 0)`,
          })
          .from(usageEvents)
          .where(eq(usageEvents.userId, input.userId))
          .groupBy(month)
          .orderBy(desc(month))
          .limit(6),
        db
          .select({
            ip: loginEvents.ip,
            userAgent: loginEvents.userAgent,
            createdAt: loginEvents.createdAt,
          })
          .from(loginEvents)
          .where(eq(loginEvents.userId, input.userId))
          .orderBy(desc(loginEvents.createdAt))
          .limit(10),
        db
          .select({ total: sql<number>`count(*)::int` })
          .from(loginEvents)
          .where(eq(loginEvents.userId, input.userId)),
        db
          .select({ total: sql<number>`count(*)::int` })
          .from(pipelineRuns)
          .where(eq(pipelineRuns.userId, input.userId)),
        db
          .select({
            message: accessRequests.message,
            contact: accessRequests.contact,
            status: accessRequests.status,
            createdAt: accessRequests.createdAt,
          })
          .from(accessRequests)
          .where(eq(accessRequests.userId, input.userId))
          .orderBy(desc(accessRequests.createdAt))
          .limit(1),
      ]);
      const minutes = await checkMinutes(db, { userId: input.userId });
      return {
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          accessStatus: user.accessStatus,
          role: user.role,
          plan: user.plan,
          createdAt: user.createdAt,
          lastSeenAt: user.lastSeenAt,
        },
        minutes: { used: minutes.used, base: minutes.base, bonus: minutes.bonus },
        usageByMonth,
        logins,
        loginCount: loginStats?.total ?? 0,
        runCount: runStats?.total ?? 0,
        latestRequest: latestRequest ?? null,
      };
    }),
});
