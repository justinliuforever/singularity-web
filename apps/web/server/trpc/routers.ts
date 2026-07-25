import "server-only";

import { and, count, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { runs, tasks } from "@trigger.dev/sdk";
import { z } from "zod";

import { createHash } from "node:crypto";

import {
  bibleImportChunks,
  bibleImportFiles,
  channels,
  channelSeries,
  checkAccountRail,
  checkMinutes,
  clerkSops,
  clerkVideos,
  competitorAccounts,
  consumeMinutes,
  GENERATION_MINUTES,
  museIdeas,
  ownAccounts,
  pipelineRuns,
  poetBible,
  poetCustomTopics,
  poetScripts,
  projectCompetitors,
  projects,
  projectSops,
  refundRunQuota,
  scriptMinutes,
} from "@goooose/db";
import {
  getChannelInfo,
  isValidYoutubeChannelUrl,
  resolveChannelId,
} from "@goooose/integrations/clients/tikhub";
import {
  expandDouyinShortLink,
  resolveDouyinUser,
} from "@goooose/integrations/clients/douyin";
import {
  expandXhsShortLink,
  isValidXhsProfileUrl,
  resolveXhsUser,
} from "@goooose/integrations/clients/xhs";
import { detectVideoLinkPlatform, isValidDouyinProfileUrl } from "@goooose/integrations/validators";
import {
  fetchChannelMetaById,
  fetchChannelMetaByHandle,
  parseYoutubeChannelUrl,
} from "@goooose/integrations/clients/youtube-data";
import { provisionalCompetitorKey } from "@goooose/domain/services/competitors";

import { db } from "@/lib/db";
import { ETA_JOB_COMMANDS } from "@/lib/eta-jobs";
import { estimateRunMinutes } from "@/lib/run-estimate";
import { COMMAND_LABEL } from "@/lib/run-labels";
import { accessRouter, adminRouter } from "./access";
import { protectedProcedure, router } from "./init";
import {
  createChannelInput,
  deleteChannelInput,
  regenerateSlugInput,
  updateChannelInput,
} from "./schemas/channels";
import {
  bindCompetitorInput,
  competitorIdInput,
  importCompetitorsInput,
} from "./schemas/competitors";
import {
  deleteSopInput,
  detectSeriesInput,
  generateVideoSopInput,
  listSeriesInput,
  resetTargetInput,
  runStatusInput,
  startAnalysisInput,
} from "./schemas/clerk";
import { approveIdeaInput, dismissIdeaInput, startMonitorInput } from "./schemas/muse";
import { createProjectInput, deleteProjectInput, updateProjectInput } from "./schemas/projects";
import {
  analyzeCustomTopicInput,
  BIBLE_IMPORT_CHUNK_BYTES,
  createBibleUploadInput,
  createCustomTopicInput,
  deleteBibleInput,
  deleteCustomTopicInput,
  deleteScriptInput,
  generateBibleInput,
  generateScriptFromCustomTopicInput,
  finalizeBibleImportInput,
  generateScriptInput,
  resolveImportFlagInput,
  switchActiveBibleInput,
  updateBibleInput,
  updateCustomTopicInput,
  uploadBibleChunkInput,
} from "./schemas/poet";

function slugify(name: string): string {
  const ascii = name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  if (ascii.length > 0) return ascii;
  // Pure-Chinese names strip to empty; a constant fallback would collide across channels.
  return `ch-${Math.random().toString(36).slice(2, 8)}`;
}

type RunOwner = { channelId: string } | { competitorAccountId: string };

async function assertNoActiveRun(owner: string | RunOwner, agent: "clerk" | "muse" | "poet") {
  const ownerObj: RunOwner = typeof owner === "string" ? { channelId: owner } : owner;
  const ownerCond =
    "channelId" in ownerObj
      ? eq(pipelineRuns.channelId, ownerObj.channelId)
      : eq(pipelineRuns.competitorAccountId, ownerObj.competitorAccountId);
  // The orphan cutoff has to sit in the WHERE, not after LIMIT 1: filtering in JS let a
  // newer stale "pending" row mask an older live "running" one, unlocking duplicate runs.
  const [active] = await db
    .select({ id: pipelineRuns.id, command: pipelineRuns.command, startedAt: pipelineRuns.startedAt })
    .from(pipelineRuns)
    .where(
      and(
        ownerCond,
        eq(pipelineRuns.agent, agent),
        inArray(pipelineRuns.status, ["pending", "running"]),
        freshActiveRunCond(),
      ),
    )
    .orderBy(desc(pipelineRuns.startedAt))
    .limit(1);
  if (active) {
    const mins = Math.floor((Date.now() - active.startedAt.getTime()) / 60_000);
    const label = COMMAND_LABEL[active.command] ?? active.command;
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `该目标正在运行「${label}」（已 ${mins} 分钟）。等它完成，或在该任务的进度卡片上取消后再启动`,
    });
  }
}

// A "pending" row that never started within 30 min (failed trigger, seeded row) must stop
// blocking; "running" rows are never filtered — the job owns them until it ends or the reaper sweeps.
function freshActiveRunCond() {
  return or(
    eq(pipelineRuns.status, "running"),
    gte(pipelineRuns.startedAt, new Date(Date.now() - 30 * 60 * 1000)),
  );
}

async function uniqueSlug(userId: string, base: string): Promise<string> {
  let candidate = base;
  let suffix = 1;
  while (true) {
    const existing = await db
      .select({ id: channels.id })
      .from(channels)
      .where(and(eq(channels.userId, userId), eq(channels.slug, candidate)))
      .limit(1);
    if (existing.length === 0) return candidate;
    suffix++;
    candidate = `${base}-${suffix}`;
  }
}

// Fails the run inline so a failed trigger call leaves no 'pending' orphan for the watchdog.
async function triggerOrFailRun(
  runId: string,
  taskId: string,
  payload: Record<string, unknown>,
  options?: { concurrencyKey?: string },
) {
  try {
    return await tasks.trigger(taskId, payload, options);
  } catch (err) {
    await db
      .update(pipelineRuns)
      .set({
        status: "failed",
        errorMessage: (err as Error).message?.slice(0, 500) ?? "trigger failed",
        completedAt: new Date(),
      })
      .where(eq(pipelineRuns.id, runId));
    await refundRunQuota(db, runId).catch(() => {});
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "无法启动后台任务，请稍后重试" });
  }
}

export type RunTaskId =
  | "clerk-analyze-channel"
  | "clerk-analyze-single-video"
  | "clerk-detect-channel-series"
  | "muse-monitor-competitors"
  | "poet-analyze-custom-topic"
  | "poet-generate-bible"
  | "poet-generate-script"
  | "poet-import-bible";

// Exhaustive over RunTaskId so a new task cannot silently ship unmetered.
//   number          — fixed charge at trigger
//   byContent       — threshold-checked here, worker settles actual minutes at run end
//   byTargetDuration— script length decides the charge
//   free            — deliberately unmetered, pending a price
const TASK_COST: Record<RunTaskId, number | "byContent" | "byTargetDuration" | "free"> = {
  "clerk-analyze-channel": "byContent",
  "clerk-analyze-single-video": GENERATION_MINUTES.singleVideo,
  "clerk-detect-channel-series": "free",
  "muse-monitor-competitors": "byContent",
  "poet-analyze-custom-topic": GENERATION_MINUTES.topic,
  "poet-generate-bible": GENERATION_MINUTES.bible,
  "poet-generate-script": "byTargetDuration",
  "poet-import-bible": GENERATION_MINUTES.bibleImport,
};

async function assertRunQuota(
  userId: string,
  taskId: RunTaskId,
  quotaMinutes?: number,
  // byContent settles at run end; gating on a flat 1 minute let a user with 1 minute left
  // start a run that settled 137.
  estimateMinutes?: number,
): Promise<number> {
  const cost = TASK_COST[taskId];
  if (cost === "free" && quotaMinutes === undefined) return 0;
  const fixed = cost === "byTargetDuration" ? scriptMinutes() : typeof cost === "number" ? cost : undefined;
  const charge = quotaMinutes ?? fixed;
  const need = charge ?? Math.max(estimateMinutes ?? 0, 1);
  const q = await checkMinutes(db, { userId, need });
  if (!q.allowed) {
    const detail = charge ? `，本次需 ${charge} 分钟` : estimateMinutes ? `，本次预计约 ${estimateMinutes} 分钟` : "";
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `本月时长额度不足（剩余 ${Math.max(q.remaining, 0)} 分钟${detail}）。可在「用量与额度」页兑换额度码，或联系我们。`,
    });
  }
  if (charge) await consumeMinutes(db, { userId, amount: charge });
  return charge ?? 0;
}

// triggerRunId is stamped into configJson so realtime tokens can be reissued later.
async function stageAndTriggerRun(args: {
  owner: { channelId: string } | { competitorAccountId: string };
  agent: "clerk" | "muse" | "poet";
  taskId: RunTaskId;
  config: Record<string, unknown>;
  payload: Record<string, unknown>;
  projectId?: string;
  userId: string;
  quotaMinutes?: number;
  estimateMinutes?: number;
}) {
  const charged = await assertRunQuota(args.userId, args.taskId, args.quotaMinutes, args.estimateMinutes);
  const [run] = await db
    .insert(pipelineRuns)
    .values({
      ...args.owner,
      ...(args.projectId ? { projectId: args.projectId } : {}),
      agent: args.agent,
      command: args.taskId,
      status: "pending",
      configJson: args.config,
      userId: args.userId,
      quotaCharged: charged,
    })
    .returning();
  if (!run) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
  const handle = await triggerOrFailRun(
    run.id,
    args.taskId,
    {
      ...args.owner,
      ...(args.projectId ? { projectId: args.projectId } : {}),
      runId: run.id,
      userId: args.userId,
      ...args.payload,
    },
    { concurrencyKey: args.userId },
  );
  await db
    .update(pipelineRuns)
    .set({ configJson: { ...args.config, triggerRunId: handle.id } })
    .where(eq(pipelineRuns.id, run.id));
  return { runId: run.id, triggerRunId: handle.id, publicAccessToken: handle.publicAccessToken };
}

// Each channel owns a same-id own_account + default project; idempotent, so it also heals
// channels predating the project layer.
async function ensureProjectSpine(c: {
  id: string;
  userId: string;
  name: string;
  slug: string;
  platform: "youtube" | "xhs" | "douyin";
  platformUrl: string;
  description: string | null;
}) {
  await db
    .insert(ownAccounts)
    .values({
      id: c.id,
      userId: c.userId,
      name: c.name,
      slug: c.slug,
      platform: c.platform,
      platformUrl: c.platformUrl,
      description: c.description,
    })
    .onConflictDoNothing();
  await db
    .insert(projects)
    .values({
      id: c.id,
      ownAccountId: c.id,
      userId: c.userId,
      name: c.name,
      slug: c.slug,
      platform: c.platform,
    })
    .onConflictDoNothing();
}

type CompetitorImportStatus = "added" | "duplicate" | "invalid" | "unresolved";

// YouTube handle/legacy keys resolve to the canonical UC so dedup matches backfilled rows;
// a soft-deleted match is un-deleted rather than duplicated (partial-unique index).
async function upsertCompetitor(
  userId: string,
  platform: "youtube" | "xhs" | "douyin",
  url: string,
): Promise<{ status: CompetitorImportStatus; id: string | null }> {
  // Mobile share pastes are short links (xhslink.com / v.douyin.com) — expand so the dedup key resolves.
  if (platform === "xhs") url = await expandXhsShortLink(url);
  else if (platform === "douyin") url = await expandDouyinShortLink(url);
  const pk = provisionalCompetitorKey(platform, url);
  if (!pk) return { status: "invalid", id: null };
  let key = pk.key;
  let needsResolution = pk.needsResolution;
  if (needsResolution) {
    try {
      const uc = await resolveChannelId(url);
      if (uc && uc.startsWith("UC")) {
        key = uc;
        needsResolution = false;
      }
    } catch {
      /* keep provisional key; reported as unresolved */
    }
  }
  const [live] = await db
    .select({ id: competitorAccounts.id })
    .from(competitorAccounts)
    .where(
      and(
        eq(competitorAccounts.userId, userId),
        eq(competitorAccounts.platform, platform),
        eq(competitorAccounts.platformKey, key),
        isNull(competitorAccounts.deletedAt),
      ),
    )
    .limit(1);
  if (live) return { status: "duplicate", id: live.id };
  const rail = await checkAccountRail(db, userId);
  if (!rail.allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `账号数已达内测上限（${rail.max} 个）。删除不用的账号可释放名额，或联系我们。`,
    });
  }
  const [dead] = await db
    .select({ id: competitorAccounts.id })
    .from(competitorAccounts)
    .where(
      and(
        eq(competitorAccounts.userId, userId),
        eq(competitorAccounts.platform, platform),
        eq(competitorAccounts.platformKey, key),
      ),
    )
    .limit(1);
  if (dead) {
    await db
      .update(competitorAccounts)
      .set({ deletedAt: null, url, updatedAt: new Date() })
      .where(eq(competitorAccounts.id, dead.id));
    return { status: "added", id: dead.id };
  }
  let name: string | null = null;
  let avatarUrl: string | null = null;
  let subscriberCount: number | null = null;
  try {
    if (platform === "xhs") {
      const u = await resolveXhsUser(url);
      name = u.nickname || null;
      avatarUrl = u.avatarUrl || null;
      subscriberCount = u.fansCount || null;
    } else if (platform === "douyin") {
      const u = await resolveDouyinUser(url);
      name = u.nickname || null;
      avatarUrl = u.avatarUrl || null;
      subscriberCount = u.followerCount || null;
    } else if (!needsResolution) {
      const info = await getChannelInfo(key);
      name = info.channel_name || null;
      avatarUrl = info.thumbnail_url;
      subscriberCount = info.subscriberCount;
    }
  } catch {
    /* metadata best-effort; monitor fetches by url regardless */
  }
  const [created] = await db
    .insert(competitorAccounts)
    .values({
      userId,
      platform,
      platformKey: key,
      url,
      name,
      avatarUrl,
      subscriberCount,
      needsResolution,
      lastVerifiedAt: name ? new Date() : null,
    })
    .onConflictDoNothing()
    .returning({ id: competitorAccounts.id });
  if (created) return { status: needsResolution ? "unresolved" : "added", id: created.id };
  const [raced] = await db
    .select({ id: competitorAccounts.id })
    .from(competitorAccounts)
    .where(
      and(
        eq(competitorAccounts.userId, userId),
        eq(competitorAccounts.platform, platform),
        eq(competitorAccounts.platformKey, key),
        isNull(competitorAccounts.deletedAt),
      ),
    )
    .limit(1);
  return { status: "duplicate", id: raced?.id ?? null };
}

// expectedOwnAccountId also pins the project to that account, blocking calls that mix
// account A's channel with account B's project.
async function assertProjectOwner(userId: string, projectId: string, expectedOwnAccountId?: string) {
  const [p] = await db
    .select({ id: projects.id, ownAccountId: projects.ownAccountId })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);
  if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
  if (expectedOwnAccountId && p.ownAccountId !== expectedOwnAccountId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "项目与账号不匹配" });
  }
  return p;
}

export const appRouter = router({
  access: accessRouter,
  admin: adminRouter,
  channels: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return db
        .select()
        .from(channels)
        .where(eq(channels.userId, ctx.user.id))
        .orderBy(desc(channels.createdAt));
    }),

    bySlug: protectedProcedure
      .input(z.object({ slug: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        const [channel] = await db
          .select()
          .from(channels)
          .where(and(eq(channels.userId, ctx.user.id), eq(channels.slug, input.slug)))
          .limit(1);
        return channel ?? null;
      }),

    context: protectedProcedure
      .input(z.object({ accountSlug: z.string().min(1), projectSlug: z.string().optional() }))
      .query(async ({ ctx, input }) => {
        const [account] = await db
          .select({
            id: channels.id,
            name: channels.name,
            slug: channels.slug,
            platform: channels.platform,
          })
          .from(channels)
          .where(and(eq(channels.userId, ctx.user.id), eq(channels.slug, input.accountSlug)))
          .limit(1);
        if (!account) return null;
        // Scalars only: this runs on every navigation, never pull poetBible.content here.
        const [activeBible] = await db
          .select({ id: poetBible.id, name: poetBible.name })
          .from(poetBible)
          .where(and(eq(poetBible.channelId, account.id), eq(poetBible.isActive, true)))
          .limit(1);
        // A parked (inactive) bible is neither active nor absent; without both counts the chip reads 未设置.
        const [parked] = await db
          .select({
            total: count(),
            unresolved: sql<number>`count(*) filter (where exists (select 1 from jsonb_array_elements(${poetBible.importFlags}) f where (f->>'resolved') is distinct from 'true'))::int`,
          })
          .from(poetBible)
          .where(and(eq(poetBible.channelId, account.id), eq(poetBible.isActive, false)));
        let project: {
          name: string;
          slug: string;
          platform: "youtube" | "xhs" | "douyin";
          targetDurationSeconds: number;
        } | null = null;
        if (input.projectSlug) {
          const [p] = await db
            .select({
              name: projects.name,
              slug: projects.slug,
              platform: projects.platform,
              targetDurationSeconds: projects.targetDurationSeconds,
            })
            .from(projects)
            .where(and(eq(projects.ownAccountId, account.id), eq(projects.slug, input.projectSlug)))
            .limit(1);
          project = p ?? null;
        }
        return {
          account: {
            name: account.name,
            slug: account.slug,
            platform: account.platform,
            activeBible: activeBible ?? null,
            parkedBibleCount: activeBible ? 0 : (parked?.total ?? 0),
            parkedUnresolvedCount: activeBible ? 0 : (parked?.unresolved ?? 0),
          },
          project,
        };
      }),

    create: protectedProcedure
      .input(createChannelInput)
      .mutation(async ({ ctx, input }) => {
        const rail = await checkAccountRail(db, ctx.user.id);
        if (!rail.allowed) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `账号数已达内测上限（${rail.max} 个）。删除不用的账号可释放名额，或联系我们。`,
          });
        }
        const slug = await uniqueSlug(ctx.user.id, slugify(input.name));
        const platformUrl =
          input.platform === "xhs"
            ? await expandXhsShortLink(input.platformUrl)
            : input.platform === "douyin"
              ? await expandDouyinShortLink(input.platformUrl)
              : input.platformUrl;
        const [created] = await db
          .insert(channels)
          .values({
            userId: ctx.user.id,
            name: input.name,
            slug,
            platform: input.platform,
            platformUrl,
            description: input.description ?? null,
          })
          .returning();
        if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        await ensureProjectSpine(created);
        return created;
      }),

    update: protectedProcedure
      .input(updateChannelInput)
      .mutation(async ({ ctx, input }) => {
        const { id, ...patch } = input;
        const platformUrl =
          patch.platform === "xhs"
            ? await expandXhsShortLink(patch.platformUrl)
            : patch.platform === "douyin"
              ? await expandDouyinShortLink(patch.platformUrl)
              : patch.platformUrl;
        const [updated] = await db
          .update(channels)
          .set({
            name: patch.name,
            platform: patch.platform,
            platformUrl,
            description: patch.description ?? null,
            updatedAt: new Date(),
          })
          .where(and(eq(channels.id, id), eq(channels.userId, ctx.user.id)))
          .returning();
        if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
        await ensureProjectSpine(updated);
        return updated;
      }),

    delete: protectedProcedure
      .input(deleteChannelInput)
      .mutation(async ({ ctx, input }) => {
        // Delete the whole account spine — removing only `channels` strands the twins.
        return await db.transaction(async (tx) => {
          const [channel] = await tx
            .select({ id: channels.id })
            .from(channels)
            .where(and(eq(channels.id, input.id), eq(channels.userId, ctx.user.id)))
            .limit(1);
          if (!channel) throw new TRPCError({ code: "NOT_FOUND" });
          await tx.delete(projects).where(eq(projects.ownAccountId, channel.id));
          await tx.delete(ownAccounts).where(eq(ownAccounts.id, channel.id));
          const [deleted] = await tx
            .delete(channels)
            .where(eq(channels.id, channel.id))
            .returning({ id: channels.id });
          return { id: deleted?.id ?? null };
        });
      }),

    verifyUrl: protectedProcedure
      .input(
        z.object({
          platform: z.enum(["youtube", "xhs", "douyin"]),
          // Not z.string().url(): mobile share pastes embed the link in card text.
          url: z.string().min(1),
        }),
      )
      .mutation(async ({ input }) => {
        if (input.platform === "douyin") {
          try {
            const expanded = await expandDouyinShortLink(input.url);
            const user = await resolveDouyinUser(expanded);
            // Bare sec_user_id pastes have no homepage URL — build the canonical one.
            const url = /^https?:\/\//i.test(expanded)
              ? expanded
              : `https://www.douyin.com/user/${user.secUserId}`;
            return {
              platform: "douyin" as const,
              url,
              name: user.nickname,
              avatarUrl: user.avatarUrl,
              subscriberCount: user.followerCount,
              awemeCount: user.awemeCount,
              uniqueId: user.uniqueId,
              ipLocation: user.ipLocation,
              signature: user.signature,
            };
          } catch {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "抖音账号验证失败，请确认主页链接正确",
            });
          }
        }
        if (input.platform === "xhs") {
          if (!isValidXhsProfileUrl(input.url)) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "URL 不是小红书主页格式（电脑端 /user/profile/{24位hex}，或手机端 xhslink.com 分享链接）",
            });
          }
          try {
            const user = await resolveXhsUser(input.url);
            return {
              platform: "xhs" as const,
              name: user.nickname || "(未命名)",
              avatarUrl: user.avatarUrl || null,
              redId: user.redId,
              fansCount: user.fansCount,
              interactionsCount: user.interactionsCount,
              description: user.desc.slice(0, 300),
              ipLocation: user.ipLocation,
            };
          } catch (err) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `XHS 验证失败：${(err as Error).message.slice(0, 200)}`,
            });
          }
        }
        if (!isValidYoutubeChannelUrl(input.url)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "URL 不是 YouTube 频道格式（应为 /@handle、/channel/UCxxx、/c/name 或 /user/name）",
          });
        }
        try {
          const parsed = parseYoutubeChannelUrl(input.url);
          let yt =
            parsed?.type === "id"
              ? await fetchChannelMetaById(parsed.channelId)
              : parsed?.type === "handle"
                ? await fetchChannelMetaByHandle(parsed.handle)
                : null;

          // Legacy /c/ and /user/ need TikHub to resolve channel id first.
          if (!yt && parsed?.type === "legacy") {
            try {
              const cid = await resolveChannelId(input.url);
              yt = await fetchChannelMetaById(cid);
            } catch {
              /* fall through to TikHub */
            }
          }

          if (yt) {
            return {
              platform: "youtube" as const,
              name: yt.title || "(未命名)",
              channelId: yt.channelId,
              subscriberCount: yt.subscriberCount,
              videoCount: yt.videoCount,
              description: yt.description.slice(0, 300),
              source: "youtube-data" as const,
            };
          }

          // Fallback: TikHub when YT Data API rejected or quota exhausted.
          const channelId = await resolveChannelId(input.url);
          const meta = await getChannelInfo(channelId);
          return {
            platform: "youtube" as const,
            name: meta.channel_name || "(未命名)",
            channelId: meta.channel_id,
            subscriberCount: meta.subscriberCount,
            videoCount: meta.videoCount,
            description: meta.description.slice(0, 300),
            source: "tikhub" as const,
          };
        } catch (err) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `YouTube 验证失败：${(err as Error).message.slice(0, 200)}`,
          });
        }
      }),

    regenerateSlug: protectedProcedure
      .input(regenerateSlugInput)
      .mutation(async ({ ctx, input }) => {
        const [existing] = await db
          .select({ name: channels.name })
          .from(channels)
          .where(and(eq(channels.id, input.id), eq(channels.userId, ctx.user.id)))
          .limit(1);
        if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
        const fresh = await uniqueSlug(ctx.user.id, slugify(existing.name));
        const [updated] = await db
          .update(channels)
          .set({ slug: fresh, updatedAt: new Date() })
          .where(and(eq(channels.id, input.id), eq(channels.userId, ctx.user.id)))
          .returning();
        if (!updated) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        return updated;
      }),

    refreshStats: protectedProcedure
      .input(z.object({ channelId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const [ch] = await db
          .select({
            id: channels.id,
            platform: channels.platform,
            platformUrl: channels.platformUrl,
            platformChannelId: channels.platformChannelId,
          })
          .from(channels)
          .where(and(eq(channels.id, input.channelId), eq(channels.userId, ctx.user.id)))
          .limit(1);
        if (!ch) throw new TRPCError({ code: "NOT_FOUND" });

        const validUrl =
          ch.platform === "xhs"
            ? isValidXhsProfileUrl(ch.platformUrl)
            : ch.platform === "douyin"
              ? isValidDouyinProfileUrl(ch.platformUrl)
              : isValidYoutubeChannelUrl(ch.platformUrl);
        if (!validUrl) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "该账号未填写有效主页链接，无法刷新",
          });
        }

        let subscriberCount: number | null = null;
        let resolvedChannelId: string | null = null;
        try {
          if (ch.platform === "xhs") {
            const u = await resolveXhsUser(ch.platformUrl);
            subscriberCount = u.fansCount ?? null;
          } else if (ch.platform === "douyin") {
            const u = await resolveDouyinUser(ch.platformUrl);
            subscriberCount = u.followerCount ?? null;
          } else {
            const parsed = parseYoutubeChannelUrl(ch.platformUrl);
            const yt =
              parsed?.type === "id"
                ? await fetchChannelMetaById(parsed.channelId)
                : parsed?.type === "handle"
                  ? await fetchChannelMetaByHandle(parsed.handle)
                  : null;
            if (yt) {
              subscriberCount = yt.subscriberCount;
              resolvedChannelId = yt.channelId;
            } else {
              const cid = ch.platformChannelId ?? (await resolveChannelId(ch.platformUrl));
              const meta = await getChannelInfo(cid);
              subscriberCount = meta.subscriberCount;
              resolvedChannelId = meta.channel_id ?? cid;
            }
          }
        } catch (err) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `刷新失败：${(err as Error).message.slice(0, 160)}`,
          });
        }
        if (subscriberCount == null) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "刷新失败：未获取到粉丝数" });
        }

        await db
          .update(channels)
          .set({
            subscriberCount,
            ...(resolvedChannelId && !ch.platformChannelId
              ? { platformChannelId: resolvedChannelId }
              : {}),
            lastVerifiedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(channels.id, ch.id));

        return { id: ch.id, subscriberCount };
      }),
  }),

  competitors: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return db
        .select({
          id: competitorAccounts.id,
          platform: competitorAccounts.platform,
          url: competitorAccounts.url,
          name: competitorAccounts.name,
          avatarUrl: competitorAccounts.avatarUrl,
          subscriberCount: competitorAccounts.subscriberCount,
          needsResolution: competitorAccounts.needsResolution,
          lastVerifiedAt: competitorAccounts.lastVerifiedAt,
          usedBy: sql<number>`(SELECT count(*)::int FROM project_competitors pc WHERE pc.competitor_account_id = ${competitorAccounts.id})`,
        })
        .from(competitorAccounts)
        .where(and(eq(competitorAccounts.userId, ctx.user.id), isNull(competitorAccounts.deletedAt)))
        .orderBy(desc(competitorAccounts.createdAt));
    }),

    listForProject: protectedProcedure
      .input(z.object({ projectId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        await assertProjectOwner(ctx.user.id, input.projectId);
        return db
          .select({
            id: competitorAccounts.id,
            platform: competitorAccounts.platform,
            url: competitorAccounts.url,
            name: competitorAccounts.name,
            avatarUrl: competitorAccounts.avatarUrl,
            subscriberCount: competitorAccounts.subscriberCount,
            needsResolution: competitorAccounts.needsResolution,
          })
          .from(projectCompetitors)
          .innerJoin(
            competitorAccounts,
            eq(competitorAccounts.id, projectCompetitors.competitorAccountId),
          )
          .where(
            and(
              eq(projectCompetitors.projectId, input.projectId),
              isNull(competitorAccounts.deletedAt),
            ),
          )
          .orderBy(desc(projectCompetitors.createdAt));
      }),

    import: protectedProcedure.input(importCompetitorsInput).mutation(async ({ ctx, input }) => {
      if (input.projectId) await assertProjectOwner(ctx.user.id, input.projectId);
      const results: Array<{
        url: string;
        platform: "youtube" | "xhs" | "douyin";
        status: CompetitorImportStatus;
        id: string | null;
      }> = [];
      for (const c of input.competitors) {
        const r = await upsertCompetitor(ctx.user.id, c.platform, c.url);
        if (r.id && input.projectId) {
          await db
            .insert(projectCompetitors)
            .values({ projectId: input.projectId, competitorAccountId: r.id })
            .onConflictDoNothing();
        }
        results.push({ url: c.url, platform: c.platform, status: r.status, id: r.id });
      }
      return { results };
    }),

    // Re-fetch the same way upsertCompetitor did so the numbers stay comparable.
    refreshStats: protectedProcedure
      .input(competitorIdInput)
      .mutation(async ({ ctx, input }) => {
        const [acct] = await db
          .select({
            id: competitorAccounts.id,
            platform: competitorAccounts.platform,
            url: competitorAccounts.url,
            platformKey: competitorAccounts.platformKey,
            needsResolution: competitorAccounts.needsResolution,
          })
          .from(competitorAccounts)
          .where(
            and(
              eq(competitorAccounts.id, input.competitorAccountId),
              eq(competitorAccounts.userId, ctx.user.id),
              isNull(competitorAccounts.deletedAt),
            ),
          )
          .limit(1);
        if (!acct) throw new TRPCError({ code: "NOT_FOUND" });

        let name: string | null = null;
        let avatarUrl: string | null = null;
        let subscriberCount: number | null = null;
        let key = acct.platformKey;
        let needsResolution = acct.needsResolution;
        try {
          if (acct.platform === "xhs") {
            const u = await resolveXhsUser(acct.url);
            name = u.nickname || null;
            avatarUrl = u.avatarUrl || null;
            subscriberCount = u.fansCount || null;
          } else if (acct.platform === "douyin") {
            const u = await resolveDouyinUser(acct.url);
            name = u.nickname || null;
            avatarUrl = u.avatarUrl || null;
            subscriberCount = u.followerCount || null;
          } else {
            if (needsResolution) {
              const uc = await resolveChannelId(acct.url);
              if (uc && uc.startsWith("UC")) {
                key = uc;
                needsResolution = false;
              }
            }
            if (!needsResolution) {
              const info = await getChannelInfo(key);
              name = info.channel_name || null;
              avatarUrl = info.thumbnail_url;
              subscriberCount = info.subscriberCount;
            }
          }
        } catch {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "刷新失败：拉取账号信息出错，请稍后重试",
          });
        }
        if (subscriberCount == null && name == null) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "刷新失败：未能获取到账号信息（链接可能已失效）",
          });
        }

        await db
          .update(competitorAccounts)
          .set({
            ...(subscriberCount != null ? { subscriberCount } : {}),
            ...(name ? { name } : {}),
            ...(avatarUrl ? { avatarUrl } : {}),
            ...(key !== acct.platformKey ? { platformKey: key, needsResolution } : {}),
            lastVerifiedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(competitorAccounts.id, acct.id));

        return { id: acct.id, subscriberCount, name };
      }),

    remove: protectedProcedure.input(competitorIdInput).mutation(async ({ ctx, input }) => {
      const [owned] = await db
        .select({ id: competitorAccounts.id })
        .from(competitorAccounts)
        .where(
          and(
            eq(competitorAccounts.id, input.competitorAccountId),
            eq(competitorAccounts.userId, ctx.user.id),
          ),
        )
        .limit(1);
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
      const used = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(projectCompetitors)
        .where(eq(projectCompetitors.competitorAccountId, input.competitorAccountId));
      const unlinked = used[0]?.n ?? 0;
      await db
        .delete(projectCompetitors)
        .where(eq(projectCompetitors.competitorAccountId, input.competitorAccountId));
      await db
        .update(competitorAccounts)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(competitorAccounts.id, input.competitorAccountId));
      return { id: input.competitorAccountId, unlinked };
    }),

    bind: protectedProcedure.input(bindCompetitorInput).mutation(async ({ ctx, input }) => {
      await assertProjectOwner(ctx.user.id, input.projectId);
      const [owned] = await db
        .select({ id: competitorAccounts.id })
        .from(competitorAccounts)
        .where(
          and(
            eq(competitorAccounts.id, input.competitorAccountId),
            eq(competitorAccounts.userId, ctx.user.id),
            isNull(competitorAccounts.deletedAt),
          ),
        )
        .limit(1);
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
      await db
        .insert(projectCompetitors)
        .values({ projectId: input.projectId, competitorAccountId: input.competitorAccountId })
        .onConflictDoNothing();
      return { ok: true };
    }),

    unbind: protectedProcedure.input(bindCompetitorInput).mutation(async ({ ctx, input }) => {
      await assertProjectOwner(ctx.user.id, input.projectId);
      await db
        .delete(projectCompetitors)
        .where(
          and(
            eq(projectCompetitors.projectId, input.projectId),
            eq(projectCompetitors.competitorAccountId, input.competitorAccountId),
          ),
        );
      return { ok: true };
    }),
  }),

  channelsMaintenance: router({
    // Converts a study-only own account into a real competitor_account, re-owning its clerk
    // history. Spine rows are deleted explicitly: own_accounts/projects have NO FK to channels.
    convertToCompetitor: protectedProcedure
      .input(z.object({ channelId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const [channel] = await db
          .select()
          .from(channels)
          .where(and(eq(channels.id, input.channelId), eq(channels.userId, ctx.user.id)))
          .limit(1);
        if (!channel) throw new TRPCError({ code: "NOT_FOUND", message: "Channel not found" });

        const [guard] = await db
          .select({
            bibles: sql<number>`(SELECT count(*)::int FROM poet_bible b WHERE b.channel_id = ${channel.id})`,
            scripts: sql<number>`(SELECT count(*)::int FROM poet_scripts s WHERE s.channel_id = ${channel.id})`,
            topics: sql<number>`(SELECT count(*)::int FROM poet_custom_topics t WHERE t.channel_id = ${channel.id})`,
            ideas: sql<number>`(SELECT count(*)::int FROM muse_ideas i WHERE i.channel_id = ${channel.id})`,
            monitored: sql<number>`(SELECT count(*)::int FROM muse_monitor_videos m WHERE m.channel_id = ${channel.id})`,
          })
          .from(sql`(SELECT 1) AS one`);
        const blockers: string[] = [];
        if (guard!.bibles > 0) blockers.push(`${guard!.bibles} 本圣经`);
        if (guard!.scripts > 0) blockers.push(`${guard!.scripts} 篇脚本`);
        if (guard!.topics > 0) blockers.push(`${guard!.topics} 个自定义选题`);
        if (guard!.ideas > 0) blockers.push(`${guard!.ideas} 个选题`);
        if (guard!.monitored > 0) blockers.push(`${guard!.monitored} 条巡视记录`);
        if (blockers.length > 0) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `该账号有自己的内容（${blockers.join("、")}），不是纯学习对象，不能转为对标`,
          });
        }
        await assertNoActiveRun({ channelId: channel.id }, "clerk");

        const keyInfo = provisionalCompetitorKey(channel.platform, channel.platformUrl);
        if (!keyInfo) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "无法从该账号主页链接解析对标标识",
          });
        }

        const competitorId = await db.transaction(async (tx) => {
          const [existing] = await tx
            .select({ id: competitorAccounts.id })
            .from(competitorAccounts)
            .where(
              and(
                eq(competitorAccounts.userId, ctx.user.id),
                eq(competitorAccounts.platform, channel.platform),
                eq(competitorAccounts.platformKey, keyInfo.key),
                isNull(competitorAccounts.deletedAt),
              ),
            )
            .limit(1);
          let compId = existing?.id;
          if (!compId) {
            const [created] = await tx
              .insert(competitorAccounts)
              .values({
                userId: ctx.user.id,
                platform: channel.platform,
                platformKey: keyInfo.key,
                url: channel.platformUrl,
                name: channel.name,
                needsResolution: keyInfo.needsResolution,
              })
              .returning({ id: competitorAccounts.id });
            compId = created!.id;
          }
          await tx
            .update(clerkVideos)
            .set({ competitorAccountId: compId, channelId: null, ownAccountId: null })
            .where(eq(clerkVideos.channelId, channel.id));
          await tx
            .update(clerkSops)
            .set({ competitorAccountId: compId, channelId: null, ownAccountId: null })
            .where(eq(clerkSops.channelId, channel.id));
          await tx
            .update(pipelineRuns)
            .set({ competitorAccountId: compId, channelId: null })
            .where(and(eq(pipelineRuns.channelId, channel.id), eq(pipelineRuns.agent, "clerk")));
          await tx.delete(projects).where(eq(projects.id, channel.id));
          await tx.delete(ownAccounts).where(eq(ownAccounts.id, channel.id));
          await tx.delete(channels).where(eq(channels.id, channel.id));
          return compId;
        });

        return { competitorAccountId: competitorId };
      }),
  }),

  sops: router({
    // Only ai_reference SOPs: that's the machine-facing document the script writer consumes.
    pickerList: protectedProcedure
      .input(z.object({ projectId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        await assertProjectOwner(ctx.user.id, input.projectId);
        const rows = await db
          .select({
            id: clerkSops.id,
            language: clerkSops.language,
            generatedAt: clerkSops.generatedAt,
            // SOPs are owned by an own channel OR a competitor (one-owner XOR, 0018).
            sourceName: sql<string>`coalesce(${channels.name}, ${competitorAccounts.name}, ${competitorAccounts.url}, '未知来源')`,
            sourceKind: sql<"own" | "competitor">`case when ${clerkSops.channelId} is not null then 'own' else 'competitor' end`,
            usedBy: sql<number>`(SELECT count(*)::int FROM project_sops ps JOIN projects p ON p.id = ps.project_id WHERE ps.sop_id = ${clerkSops.id} AND ps.role = 'primary' AND p.user_id = ${ctx.user.id})`,
            isCurrent: sql<boolean>`EXISTS (SELECT 1 FROM project_sops ps WHERE ps.sop_id = ${clerkSops.id} AND ps.project_id = ${input.projectId} AND ps.role = 'primary')`,
          })
          .from(clerkSops)
          .leftJoin(channels, eq(channels.id, clerkSops.channelId))
          .leftJoin(competitorAccounts, eq(competitorAccounts.id, clerkSops.competitorAccountId))
          .where(
            and(
              or(eq(channels.userId, ctx.user.id), eq(competitorAccounts.userId, ctx.user.id)),
              eq(clerkSops.sopType, "ai_reference"),
            ),
          )
          .orderBy(desc(clerkSops.generatedAt));
        return rows;
      }),

    setPrimary: protectedProcedure
      .input(z.object({ projectId: z.string().uuid(), sopId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        await assertProjectOwner(ctx.user.id, input.projectId);
        const [sop] = await db
          .select({ id: clerkSops.id })
          .from(clerkSops)
          .leftJoin(channels, eq(channels.id, clerkSops.channelId))
          .leftJoin(competitorAccounts, eq(competitorAccounts.id, clerkSops.competitorAccountId))
          .where(
            and(
              eq(clerkSops.id, input.sopId),
              or(eq(channels.userId, ctx.user.id), eq(competitorAccounts.userId, ctx.user.id)),
            ),
          )
          .limit(1);
        if (!sop) throw new TRPCError({ code: "NOT_FOUND", message: "SOP not found" });
        await db.transaction(async (tx) => {
          await tx
            .delete(projectSops)
            .where(and(eq(projectSops.projectId, input.projectId), eq(projectSops.role, "primary")));
          await tx
            .insert(projectSops)
            .values({ projectId: input.projectId, sopId: input.sopId, role: "primary" })
            .onConflictDoUpdate({
              target: [projectSops.projectId, projectSops.sopId],
              set: { role: "primary" },
            });
        });
        return { ok: true };
      }),
  }),

  pipeline: router({
    listActiveAll: protectedProcedure.query(async ({ ctx }) => {
      return db
        .select({
          id: pipelineRuns.id,
          agent: pipelineRuns.agent,
          command: pipelineRuns.command,
          status: pipelineRuns.status,
          startedAt: pipelineRuns.startedAt,
          progress: pipelineRuns.progress,
          total: pipelineRuns.total,
          channelSlug: channels.slug,
          // The default project shares the account slug but a named one does not — deep links need this.
          projectSlug: projects.slug,
          competitorAccountId: pipelineRuns.competitorAccountId,
          targetName: sql<string>`coalesce(${channels.name}, ${competitorAccounts.name}, ${competitorAccounts.url}, '未知目标')`,
        })
        .from(pipelineRuns)
        .leftJoin(channels, eq(channels.id, pipelineRuns.channelId))
        .leftJoin(projects, eq(projects.id, pipelineRuns.projectId))
        .leftJoin(competitorAccounts, eq(competitorAccounts.id, pipelineRuns.competitorAccountId))
        .where(
          and(
            or(eq(channels.userId, ctx.user.id), eq(competitorAccounts.userId, ctx.user.id)),
            inArray(pipelineRuns.status, ["pending", "running"]),
            freshActiveRunCond(),
          ),
        )
        .orderBy(desc(pipelineRuns.startedAt));
    }),

    // Deliberately global, not per-user: duration depends on job + input size.
    etaHints: protectedProcedure
      .input(z.object({ jobKey: z.enum(["clerk.analyze", "muse.monitor", "poet.script", "poet.bible"]) }))
      .query(async ({ input }) => {
        const { commands } = ETA_JOB_COMMANDS[input.jobKey];
        const durationExpr = sql`extract(epoch from (${pipelineRuns.completedAt} - ${pipelineRuns.startedAt}))`;
        const [row] = await db
          .select({
            n: sql<number>`count(*)::int`,
            p50: sql<number>`coalesce(percentile_cont(0.5) within group (order by ${durationExpr}), 0)`,
            p90: sql<number>`coalesce(percentile_cont(0.9) within group (order by ${durationExpr}), 0)`,
          })
          .from(pipelineRuns)
          .where(
            and(
              inArray(pipelineRuns.command, commands),
              eq(pipelineRuns.status, "done"),
              sql`${pipelineRuns.completedAt} is not null`,
              // Outlier guard: drop sub-5s noise and stuck-completed runs (> 4h).
              sql`${durationExpr} between 5 and 14400`,
            ),
          );
        return { n: row?.n ?? 0, p50Sec: Math.round(row?.p50 ?? 0), p90Sec: Math.round(row?.p90 ?? 0) };
      }),

    cancelRun: protectedProcedure
      .input(z.object({ runId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const [run] = await db
          .select({
            id: pipelineRuns.id,
            configJson: pipelineRuns.configJson,
            status: pipelineRuns.status,
          })
          .from(pipelineRuns)
          .leftJoin(channels, eq(channels.id, pipelineRuns.channelId))
          .leftJoin(competitorAccounts, eq(competitorAccounts.id, pipelineRuns.competitorAccountId))
          .where(
            and(
              eq(pipelineRuns.id, input.runId),
              or(eq(channels.userId, ctx.user.id), eq(competitorAccounts.userId, ctx.user.id)),
            ),
          )
          .limit(1);
        if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Run not found" });
        // Cancel refunds unconditionally, so a settled run must never reach it.
        if (run.status !== "pending" && run.status !== "running") {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "任务已结束，无法取消" });
        }

        const triggerRunId = (run.configJson as { triggerRunId?: string } | null)?.triggerRunId;
        if (triggerRunId) {
          try {
            await runs.cancel(triggerRunId);
          } catch {
            /* Trigger.dev side may already be terminal — swallow. */
          }
        }
        await db
          .update(pipelineRuns)
          .set({ status: "failed", errorMessage: "User canceled", completedAt: new Date() })
          .where(eq(pipelineRuns.id, run.id));
        await refundRunQuota(db, run.id).catch(() => {});
        return { runId: run.id };
      }),
  }),

  clerk: router({
    startAnalysis: protectedProcedure
      .input(startAnalysisInput)
      .mutation(async ({ ctx, input }) => {
        let owner: { channelId: string } | { competitorAccountId: string };
        let platform = "xhs";
        if (input.channelId) {
          const [channel] = await db
            .select({ id: channels.id, platform: channels.platform })
            .from(channels)
            .where(and(eq(channels.id, input.channelId), eq(channels.userId, ctx.user.id)))
            .limit(1);
          if (!channel) throw new TRPCError({ code: "NOT_FOUND", message: "Channel not found" });
          owner = { channelId: channel.id };
          platform = channel.platform;
        } else {
          const [comp] = await db
            .select({ id: competitorAccounts.id, platform: competitorAccounts.platform })
            .from(competitorAccounts)
            .where(
              and(
                eq(competitorAccounts.id, input.competitorAccountId!),
                eq(competitorAccounts.userId, ctx.user.id),
                isNull(competitorAccounts.deletedAt),
              ),
            )
            .limit(1);
          if (!comp) throw new TRPCError({ code: "NOT_FOUND", message: "Competitor not found" });
          owner = { competitorAccountId: comp.id };
          platform = comp.platform;
        }

        await assertNoActiveRun(owner, "clerk");

        const config = {
          limit: input.limit,
          language: input.language,
          mode: input.mode,
          source: input.source,
          videoIds: input.videoIds,
          recencyMonths: input.recencyMonths,
        };
        return stageAndTriggerRun({
          userId: ctx.user.id,
          owner,
          agent: "clerk",
          taskId: "clerk-analyze-channel",
          config,
          payload: config,
          // videoIds defaults to [] and is never nullish, so `||` not `??` — else the estimate is 0.
          estimateMinutes: estimateRunMinutes(platform, input.videoIds.length || input.limit || 0),
        });
      }),

    generateVideoSop: protectedProcedure
      .input(generateVideoSopInput)
      .mutation(async ({ ctx, input }) => {
        const [video] = await db
          .select({
            id: clerkVideos.id,
            channelId: clerkVideos.channelId,
            competitorAccountId: clerkVideos.competitorAccountId,
            transcript: clerkVideos.transcript,
            contentType: clerkVideos.contentType,
          })
          .from(clerkVideos)
          .leftJoin(channels, eq(channels.id, clerkVideos.channelId))
          .leftJoin(competitorAccounts, eq(competitorAccounts.id, clerkVideos.competitorAccountId))
          .where(
            and(
              eq(clerkVideos.id, input.videoId),
              or(eq(channels.userId, ctx.user.id), eq(competitorAccounts.userId, ctx.user.id)),
            ),
          )
          .limit(1);
        if (!video) throw new TRPCError({ code: "NOT_FOUND", message: "视频不存在" });
        if (!video.transcript || !video.transcript.trim()) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: video.contentType.endsWith("_image")
              ? "这条图文没有正文内容，无法拆解"
              : "该视频没有字幕/转写，无法生成单条拆解",
          });
        }

        const owner: { channelId: string } | { competitorAccountId: string } = video.channelId
          ? { channelId: video.channelId }
          : { competitorAccountId: video.competitorAccountId! };
        await assertNoActiveRun(owner, "clerk");

        const config = { videoId: video.id, language: input.language };
        return stageAndTriggerRun({
          userId: ctx.user.id,
          owner,
          agent: "clerk",
          taskId: "clerk-analyze-single-video",
          config,
          payload: config,
        });
      }),

    runStatus: protectedProcedure
      .input(runStatusInput)
      .query(async ({ ctx, input }) => {
        const [run] = await db
          .select({
            id: pipelineRuns.id,
            channelId: pipelineRuns.channelId,
            agent: pipelineRuns.agent,
            status: pipelineRuns.status,
            progress: pipelineRuns.progress,
            total: pipelineRuns.total,
            startedAt: pipelineRuns.startedAt,
            completedAt: pipelineRuns.completedAt,
            errorMessage: pipelineRuns.errorMessage,
            configJson: pipelineRuns.configJson,
          })
          .from(pipelineRuns)
          .leftJoin(channels, eq(channels.id, pipelineRuns.channelId))
          .leftJoin(competitorAccounts, eq(competitorAccounts.id, pipelineRuns.competitorAccountId))
          .where(
            and(
              eq(pipelineRuns.id, input.runId),
              or(eq(channels.userId, ctx.user.id), eq(competitorAccounts.userId, ctx.user.id)),
            ),
          )
          .limit(1);
        return run ?? null;
      }),

    deleteSop: protectedProcedure
      .input(deleteSopInput)
      .mutation(async ({ ctx, input }) => {
        const [deleted] = await db
          .delete(clerkSops)
          .where(
            and(
              eq(clerkSops.id, input.sopId),
              or(
                inArray(
                  clerkSops.channelId,
                  db
                    .select({ id: channels.id })
                    .from(channels)
                    .where(eq(channels.userId, ctx.user.id)),
                ),
                inArray(
                  clerkSops.competitorAccountId,
                  db
                    .select({ id: competitorAccounts.id })
                    .from(competitorAccounts)
                    .where(eq(competitorAccounts.userId, ctx.user.id)),
                ),
              ),
            ),
          )
          .returning({ id: clerkSops.id });
        return { id: deleted?.id ?? null };
      }),

    resetTarget: protectedProcedure
      .input(resetTargetInput)
      .mutation(async ({ ctx, input }) => {
        if (input.channelId) {
          const [own] = await db
            .select({ id: channels.id })
            .from(channels)
            .where(and(eq(channels.id, input.channelId), eq(channels.userId, ctx.user.id)))
            .limit(1);
          if (!own) throw new TRPCError({ code: "NOT_FOUND" });
          await db.delete(clerkSops).where(eq(clerkSops.channelId, own.id));
          await db.delete(clerkVideos).where(eq(clerkVideos.channelId, own.id));
        } else {
          const [comp] = await db
            .select({ id: competitorAccounts.id })
            .from(competitorAccounts)
            .where(
              and(
                eq(competitorAccounts.id, input.competitorAccountId!),
                eq(competitorAccounts.userId, ctx.user.id),
              ),
            )
            .limit(1);
          if (!comp) throw new TRPCError({ code: "NOT_FOUND" });
          await db.delete(clerkSops).where(eq(clerkSops.competitorAccountId, comp.id));
          await db.delete(clerkVideos).where(eq(clerkVideos.competitorAccountId, comp.id));
        }
        return { ok: true };
      }),

    // Unlike resetTarget this keeps the videos; project_sops bindings cascade-unbind, so the caller must warn.
    deleteSopsForOwner: protectedProcedure
      .input(resetTargetInput)
      .mutation(async ({ ctx, input }) => {
        if (input.channelId) {
          const [own] = await db
            .select({ id: channels.id })
            .from(channels)
            .where(and(eq(channels.id, input.channelId), eq(channels.userId, ctx.user.id)))
            .limit(1);
          if (!own) throw new TRPCError({ code: "NOT_FOUND" });
          const rows = await db
            .delete(clerkSops)
            .where(eq(clerkSops.channelId, own.id))
            .returning({ id: clerkSops.id });
          return { deleted: rows.length };
        }
        const [comp] = await db
          .select({ id: competitorAccounts.id })
          .from(competitorAccounts)
          .where(
            and(
              eq(competitorAccounts.id, input.competitorAccountId!),
              eq(competitorAccounts.userId, ctx.user.id),
            ),
          )
          .limit(1);
        if (!comp) throw new TRPCError({ code: "NOT_FOUND" });
        const rows = await db
          .delete(clerkSops)
          .where(eq(clerkSops.competitorAccountId, comp.id))
          .returning({ id: clerkSops.id });
        return { deleted: rows.length };
      }),

    listSeries: protectedProcedure
      .input(listSeriesInput)
      .query(async ({ ctx, input }) => {
        const [channel] = await db
          .select({ id: channels.id })
          .from(channels)
          .where(and(eq(channels.id, input.channelId), eq(channels.userId, ctx.user.id)))
          .limit(1);
        if (!channel) return [];
        return db
          .select()
          .from(channelSeries)
          .where(eq(channelSeries.channelId, channel.id))
          .orderBy(desc(channelSeries.videoCount));
      }),

    detectSeries: protectedProcedure
      .input(detectSeriesInput)
      .mutation(async ({ ctx, input }) => {
        const [channel] = await db
          .select()
          .from(channels)
          .where(and(eq(channels.id, input.channelId), eq(channels.userId, ctx.user.id)))
          .limit(1);
        if (!channel) throw new TRPCError({ code: "NOT_FOUND", message: "Channel not found" });

        await assertNoActiveRun(channel.id, "clerk");

        return stageAndTriggerRun({
          userId: ctx.user.id,
          owner: { channelId: channel.id },
          agent: "clerk",
          taskId: "clerk-detect-channel-series",
          config: { videoCount: input.videoCount, language: input.language },
          payload: { videoCount: input.videoCount, language: input.language },
        });
      }),
  }),

  muse: router({
    startMonitor: protectedProcedure
      .input(startMonitorInput)
      .mutation(async ({ ctx, input }) => {
        const [channel] = await db
          .select()
          .from(channels)
          .where(and(eq(channels.id, input.channelId), eq(channels.userId, ctx.user.id)))
          .limit(1);
        if (!channel) throw new TRPCError({ code: "NOT_FOUND", message: "Channel not found" });
        await assertProjectOwner(ctx.user.id, input.projectId, channel.id);
        // Links mode patrols exactly the pasted URLs — competitor bindings don't apply.
        const linksMode = input.sourceMode === "links";
        let selectedIds: string[] | undefined;
        // Platforms survive the block below: competitors.bind does not check platform, so a
        // douyin account can hold YouTube competitors, and a YouTube item costs ~2.7x a douyin one.
        let boundPlatforms: string[] = [];
        let extraPlatforms: string[] = [];
        let extraIds: string[] | undefined;
        if (!linksMode) {
          // Same source as the monitor job: live project_competitors.
          const bound = await db
            .select({ id: competitorAccounts.id, platform: competitorAccounts.platform })
            .from(projectCompetitors)
            .innerJoin(
              competitorAccounts,
              eq(competitorAccounts.id, projectCompetitors.competitorAccountId),
            )
            .where(
              and(
                eq(projectCompetitors.projectId, input.projectId),
                isNull(competitorAccounts.deletedAt),
              ),
            );
          if (bound.length === 0) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: "请先为该频道配置至少一个对标账号",
            });
          }
          const boundIds = new Set(bound.map((b) => b.id));
          selectedIds = input.competitorAccountIds?.filter((id) => boundIds.has(id));
          boundPlatforms = (
            selectedIds ? bound.filter((b) => selectedIds!.includes(b.id)) : bound
          ).map((b) => b.platform);

          // Temp competitors: must be the user's, but need NOT be bound to this project.
          const extraReq = input.extraCompetitorAccountIds?.filter((id) => !boundIds.has(id));
          if (extraReq && extraReq.length > 0) {
            const owned = await db
              .select({ id: competitorAccounts.id, platform: competitorAccounts.platform })
              .from(competitorAccounts)
              .where(
                and(
                  inArray(competitorAccounts.id, extraReq),
                  eq(competitorAccounts.userId, ctx.user.id),
                  isNull(competitorAccounts.deletedAt),
                ),
              );
            if (owned.length !== extraReq.length) {
              throw new TRPCError({
                code: "PRECONDITION_FAILED",
                message: "临时对标账号不存在或不属于你",
              });
            }
            extraIds = owned.map((o) => o.id);
            extraPlatforms = owned.map((o) => o.platform);
          }

          // selectedIds === [] is a valid extras-only run; reject only when nothing at all would run.
          if (
            input.competitorAccountIds &&
            (selectedIds?.length ?? 0) === 0 &&
            (extraIds?.length ?? 0) === 0
          ) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: "请至少选择一个对标账号",
            });
          }
        }

        // Playbook reference must be one of the user's own SOPs (any of the three owner chains).
        if (input.sopId) {
          const [sop] = await db
            .select({ id: clerkSops.id })
            .from(clerkSops)
            .leftJoin(channels, eq(channels.id, clerkSops.channelId))
            .leftJoin(ownAccounts, eq(ownAccounts.id, clerkSops.ownAccountId))
            .leftJoin(competitorAccounts, eq(competitorAccounts.id, clerkSops.competitorAccountId))
            .where(
              and(
                eq(clerkSops.id, input.sopId),
                or(
                  eq(channels.userId, ctx.user.id),
                  eq(ownAccounts.userId, ctx.user.id),
                  eq(competitorAccounts.userId, ctx.user.id),
                ),
              ),
            )
            .limit(1);
          if (!sop) {
            throw new TRPCError({ code: "NOT_FOUND", message: "打法参考 SOP 不存在或不属于你" });
          }
        }

        await assertNoActiveRun(channel.id, "muse");

        const contentFilter = input.contentFilter ?? input.xhsContentType ?? "all";
        const direction = input.direction?.trim() || undefined;

        // Size every item by ITS OWN platform, not the account's. Pasted links can mix
        // platforms and bound competitors need not share the account's; a YouTube item is
        // ~2.7x a douyin one. Links are deduped first because the worker resolves them once.
        const perCompetitor = input.maxVideosPerCompetitor ?? 10;
        const estimateMinutes = linksMode
          ? [...new Set((input.videoUrls ?? []).map((u) => u.trim()))].reduce(
              (sum, url) => sum + estimateRunMinutes(detectVideoLinkPlatform(url) ?? channel.platform, 1),
              0,
            )
          : [...boundPlatforms, ...extraPlatforms].reduce(
              (sum, platform) => sum + estimateRunMinutes(platform, perCompetitor),
              0,
            );
        return stageAndTriggerRun({
          userId: ctx.user.id,
          owner: { channelId: channel.id },
          projectId: input.projectId,
          agent: "muse",
          taskId: "muse-monitor-competitors",
          estimateMinutes,
          config: {
            numIdeasPerVideo: input.numIdeasPerVideo,
            language: input.language,
            ...(linksMode
              ? { sourceMode: "links", videoUrls: input.videoUrls }
              : {
                  maxVideosPerCompetitor: input.maxVideosPerCompetitor,
                  ...(selectedIds ? { competitorAccountIds: selectedIds } : {}),
                  ...(extraIds ? { extraCompetitorAccountIds: extraIds } : {}),
                  contentFilter,
                }),
            ...(direction ? { direction } : {}),
            ...(input.sopId ? { sopId: input.sopId } : {}),
          },
          payload: {
            numIdeasPerVideo: input.numIdeasPerVideo,
            language: input.language,
            ...(linksMode
              ? { sourceMode: "links" as const, videoUrls: input.videoUrls }
              : {
                  maxVideosPerCompetitor: input.maxVideosPerCompetitor,
                  competitorAccountIds: selectedIds,
                  extraCompetitorAccountIds: extraIds,
                  contentFilter,
                }),
            direction,
            sopId: input.sopId,
          },
        });
      }),

    // Options for the patrol's playbook selector — every SOP the user owns, light rows only.
    sopOptions: protectedProcedure.query(async ({ ctx }) => {
      return db
        .select({
          id: clerkSops.id,
          sopType: clerkSops.sopType,
          language: clerkSops.language,
          generatedAt: clerkSops.generatedAt,
          group: sql<"single_video" | "competitor" | "own">`case
            when ${clerkSops.sopType} = 'single_video' then 'single_video'
            when ${clerkSops.competitorAccountId} is not null then 'competitor'
            else 'own' end`,
          label: sql<string>`coalesce(${clerkVideos.title}, ${channels.name}, ${ownAccounts.name}, ${competitorAccounts.name}, ${competitorAccounts.url}, '未命名 SOP')`,
        })
        .from(clerkSops)
        .leftJoin(channels, eq(channels.id, clerkSops.channelId))
        .leftJoin(ownAccounts, eq(ownAccounts.id, clerkSops.ownAccountId))
        .leftJoin(competitorAccounts, eq(competitorAccounts.id, clerkSops.competitorAccountId))
        .leftJoin(clerkVideos, eq(clerkVideos.id, clerkSops.videoId))
        .where(
          or(
            eq(channels.userId, ctx.user.id),
            eq(ownAccounts.userId, ctx.user.id),
            eq(competitorAccounts.userId, ctx.user.id),
          ),
        )
        .orderBy(desc(clerkSops.generatedAt));
    }),

    approveIdea: protectedProcedure
      .input(approveIdeaInput)
      .mutation(async ({ ctx, input }) => {
        const [updated] = await db
          .update(museIdeas)
          .set({
            approved: input.approved,
            approvedAt: input.approved ? new Date() : null,
            // Approving must un-dismiss (mutually exclusive states).
            ...(input.approved ? { dismissedAt: null } : {}),
          })
          .where(
            and(
              eq(museIdeas.id, input.ideaId),
              inArray(
                museIdeas.channelId,
                db
                  .select({ id: channels.id })
                  .from(channels)
                  .where(eq(channels.userId, ctx.user.id)),
              ),
            ),
          )
          .returning();
        if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
        return updated;
      }),

    dismissIdea: protectedProcedure
      .input(dismissIdeaInput)
      .mutation(async ({ ctx, input }) => {
        const [updated] = await db
          .update(museIdeas)
          .set({
            dismissedAt: input.dismissed ? new Date() : null,
            // Dismissing clears approval (mutually exclusive states).
            ...(input.dismissed ? { approved: false } : {}),
          })
          .where(
            and(
              eq(museIdeas.id, input.ideaId),
              inArray(
                museIdeas.channelId,
                db
                  .select({ id: channels.id })
                  .from(channels)
                  .where(eq(channels.userId, ctx.user.id)),
              ),
            ),
          )
          .returning();
        if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
        return updated;
      }),
  }),

  poet: router({
    generateBible: protectedProcedure
      .input(generateBibleInput)
      .mutation(async ({ ctx, input }) => {
        const [channel] = await db
          .select()
          .from(channels)
          .where(and(eq(channels.id, input.channelId), eq(channels.userId, ctx.user.id)))
          .limit(1);
        if (!channel) throw new TRPCError({ code: "NOT_FOUND" });

        await assertNoActiveRun(channel.id, "poet");

        return stageAndTriggerRun({
          userId: ctx.user.id,
          owner: { channelId: channel.id },
          agent: "poet",
          taskId: "poet-generate-bible",
          config: { language: input.language, kind: "bible" },
          payload: { ideaText: input.ideaText, name: input.name, language: input.language },
        });
      }),


    createBibleUpload: protectedProcedure
      .input(createBibleUploadInput)
      .mutation(async ({ ctx, input }) => {
        const [channel] = await db
          .select({ id: channels.id })
          .from(channels)
          .where(and(eq(channels.id, input.channelId), eq(channels.userId, ctx.user.id)))
          .limit(1);
        if (!channel) throw new TRPCError({ code: "NOT_FOUND" });
        if (input.chunkCount !== Math.ceil(input.size / BIBLE_IMPORT_CHUNK_BYTES)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "分片数量与文件大小不符" });
        }
        const [file] = await db
          .insert(bibleImportFiles)
          .values({
            userId: ctx.user.id,
            channelId: input.channelId,
            filename: input.filename,
            mime: input.mime,
            size: input.size,
            sha256: input.sha256,
            expectedChunks: input.chunkCount,
          })
          .returning({ id: bibleImportFiles.id });
        if (!file) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        return { fileId: file.id };
      }),

    uploadBibleChunk: protectedProcedure
      .input(uploadBibleChunkInput)
      .mutation(async ({ ctx, input }) => {
        const [file] = await db
          .select()
          .from(bibleImportFiles)
          .where(and(eq(bibleImportFiles.id, input.fileId), eq(bibleImportFiles.userId, ctx.user.id)))
          .limit(1);
        if (!file) throw new TRPCError({ code: "NOT_FOUND" });
        if (file.status !== "uploading") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "上传已结束，不能追加分片" });
        }
        if (input.idx >= file.expectedChunks) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "分片序号越界" });
        }
        const bytes = Buffer.from(input.dataBase64, "base64");
        if (bytes.length === 0 || bytes.length > BIBLE_IMPORT_CHUNK_BYTES) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "分片大小异常" });
        }
        // Upsert on (file_id, idx): retries and out-of-order arrival are safe.
        await db
          .insert(bibleImportChunks)
          .values({ fileId: file.id, idx: input.idx, bytes: new Uint8Array(bytes) })
          .onConflictDoUpdate({
            target: [bibleImportChunks.fileId, bibleImportChunks.idx],
            set: { bytes: new Uint8Array(bytes) },
          });
        return { received: input.idx };
      }),

    finalizeBibleImport: protectedProcedure
      .input(finalizeBibleImportInput)
      .mutation(async ({ ctx, input }) => {
        const [file] = await db
          .select()
          .from(bibleImportFiles)
          .where(and(eq(bibleImportFiles.id, input.fileId), eq(bibleImportFiles.userId, ctx.user.id)))
          .limit(1);
        if (!file) throw new TRPCError({ code: "NOT_FOUND" });
        if (file.status !== "uploading") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "该上传已处理过" });
        }
        await assertNoActiveRun(file.channelId, "poet");

        const chunks = await db
          .select({ idx: bibleImportChunks.idx, bytes: bibleImportChunks.bytes })
          .from(bibleImportChunks)
          .where(eq(bibleImportChunks.fileId, file.id))
          .orderBy(bibleImportChunks.idx);
        if (chunks.length !== file.expectedChunks) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `上传不完整（${chunks.length}/${file.expectedChunks} 分片）` });
        }
        const assembled = Buffer.concat(chunks.map((c) => Buffer.from(c.bytes)));
        const markInvalid = async (message: string) => {
          await db.update(bibleImportFiles).set({ status: "invalid" }).where(eq(bibleImportFiles.id, file.id));
          throw new TRPCError({ code: "BAD_REQUEST", message });
        };
        if (assembled.length !== file.size) await markInvalid("文件大小与上传声明不符，请重新上传");
        const digest = createHash("sha256").update(assembled).digest("hex");
        if (digest !== file.sha256) await markInvalid("文件校验失败（sha256 不匹配），请重新上传");
        // Magic bytes: reject renamed/garbage files before spending any quota.
        if (file.mime === "application/pdf" && assembled.subarray(0, 4).toString("latin1") !== "%PDF") {
          await markInvalid("文件不是有效的 PDF");
        }
        if (
          file.mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" &&
          !(assembled[0] === 0x50 && assembled[1] === 0x4b && assembled[2] === 0x03 && assembled[3] === 0x04)
        ) {
          await markInvalid("文件不是有效的 .docx");
        }
        if (file.mime === "text/markdown" || file.mime === "text/plain") {
          try {
            new TextDecoder("utf-8", { fatal: true }).decode(assembled);
          } catch {
            await markInvalid("文本文件不是有效的 UTF-8 编码");
          }
        }

        await db.update(bibleImportFiles).set({ status: "ready" }).where(eq(bibleImportFiles.id, file.id));
        return stageAndTriggerRun({
          userId: ctx.user.id,
          owner: { channelId: file.channelId },
          agent: "poet",
          taskId: "poet-import-bible",
          config: { language: input.language, kind: "bible-import", filename: file.filename },
          payload: { fileId: file.id, name: input.name, language: input.language },
          quotaMinutes: GENERATION_MINUTES.bibleImport,
        });
      }),

    resolveImportFlag: protectedProcedure
      .input(resolveImportFlagInput)
      .mutation(async ({ ctx, input }) => {
        const [row] = await db
          .select({ bible: poetBible })
          .from(poetBible)
          .innerJoin(channels, eq(channels.id, poetBible.channelId))
          .where(and(eq(poetBible.id, input.bibleId), eq(channels.userId, ctx.user.id)))
          .limit(1);
        if (!row) throw new TRPCError({ code: "NOT_FOUND" });
        const flags = [...(row.bible.importFlags ?? [])];
        if (!flags[input.flagIndex]) throw new TRPCError({ code: "BAD_REQUEST", message: "存疑项不存在" });
        flags[input.flagIndex] = { ...flags[input.flagIndex]!, resolved: true };
        await db
          .update(poetBible)
          .set({ importFlags: flags, updatedAt: new Date() })
          .where(eq(poetBible.id, input.bibleId));
        return { remaining: flags.filter((f) => !f.resolved).length };
      }),

    updateBible: protectedProcedure
      .input(updateBibleInput)
      .mutation(async ({ ctx, input }) => {
        const [updated] = await db
          .update(poetBible)
          .set({
            name: input.name ?? undefined,
            content: input.content ?? undefined,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(poetBible.id, input.bibleId),
              inArray(
                poetBible.channelId,
                db
                  .select({ id: channels.id })
                  .from(channels)
                  .where(eq(channels.userId, ctx.user.id)),
              ),
            ),
          )
          .returning();
        if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
        return updated;
      }),

    activateBible: protectedProcedure
      .input(switchActiveBibleInput)
      .mutation(async ({ ctx, input }) => {
        const [target] = await db
          .select()
          .from(poetBible)
          .innerJoin(channels, eq(channels.id, poetBible.channelId))
          .where(and(eq(poetBible.id, input.bibleId), eq(channels.userId, ctx.user.id)))
          .limit(1);
        if (!target) throw new TRPCError({ code: "NOT_FOUND" });
        const unresolved = (target.poet_bible.importFlags ?? []).filter((f) => !f.resolved).length;
        if (unresolved > 0) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `该圣经还有 ${unresolved} 个存疑项未确认，请先在详情页逐项确认后再激活`,
          });
        }

        await db
          .update(poetBible)
          .set({ isActive: false })
          .where(
            and(
              eq(poetBible.channelId, target.poet_bible.channelId),
              eq(poetBible.isActive, true),
            ),
          );
        const [activated] = await db
          .update(poetBible)
          .set({ isActive: true, updatedAt: new Date() })
          .where(eq(poetBible.id, input.bibleId))
          .returning();
        // Bibles are account-level; pinless projects fall back to it via resolveActiveBible.
        if (input.projectId) {
          await assertProjectOwner(ctx.user.id, input.projectId, target.poet_bible.channelId);
          await db
            .update(projects)
            .set({ activeBibleId: input.bibleId, updatedAt: new Date() })
            .where(eq(projects.id, input.projectId));
        }
        return activated;
      }),

    generateScript: protectedProcedure
      .input(generateScriptInput)
      .mutation(async ({ ctx, input }) => {
        const [channel] = await db
          .select()
          .from(channels)
          .where(and(eq(channels.id, input.channelId), eq(channels.userId, ctx.user.id)))
          .limit(1);
        if (!channel) throw new TRPCError({ code: "NOT_FOUND" });
        await assertProjectOwner(ctx.user.id, input.projectId, channel.id);

        const [activeBible] = await db
          .select({ id: poetBible.id })
          .from(poetBible)
          .where(and(eq(poetBible.channelId, channel.id), eq(poetBible.isActive, true)))
          .limit(1);
        if (!activeBible) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "请先为该频道生成并激活一份频道圣经",
          });
        }

        const [idea] = await db
          .select({ id: museIdeas.id, approved: museIdeas.approved })
          .from(museIdeas)
          .where(and(eq(museIdeas.id, input.ideaId), eq(museIdeas.projectId, input.projectId)))
          .limit(1);
        if (!idea) throw new TRPCError({ code: "NOT_FOUND", message: "选题不存在" });
        if (!idea.approved) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "请先通过该选题再开始写稿",
          });
        }

        await assertNoActiveRun(channel.id, "poet");

        const chargeDuration =
          input.durationSeconds ??
          (
            await db
              .select({ d: projects.targetDurationSeconds })
              .from(projects)
              .where(eq(projects.id, input.projectId))
              .limit(1)
          )[0]?.d;

        return stageAndTriggerRun({
          userId: ctx.user.id,
          quotaMinutes: scriptMinutes(chargeDuration),
          owner: { channelId: channel.id },
          projectId: input.projectId,
          agent: "poet",
          taskId: "poet-generate-script",
          config: {
            kind: "script",
            ideaId: input.ideaId,
            language: input.language,
            durationSeconds: input.durationSeconds,
          },
          payload: {
            ideaId: input.ideaId,
            language: input.language,
            durationSeconds: input.durationSeconds,
          },
        });
      }),

    listCustomTopics: protectedProcedure
      .input(z.object({ channelId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const [channel] = await db
          .select({ id: channels.id })
          .from(channels)
          .where(and(eq(channels.id, input.channelId), eq(channels.userId, ctx.user.id)))
          .limit(1);
        if (!channel) throw new TRPCError({ code: "NOT_FOUND" });
        return db
          .select()
          .from(poetCustomTopics)
          .where(eq(poetCustomTopics.channelId, channel.id))
          .orderBy(desc(poetCustomTopics.updatedAt));
      }),

    createCustomTopic: protectedProcedure
      .input(createCustomTopicInput)
      .mutation(async ({ ctx, input }) => {
        const [channel] = await db
          .select({ id: channels.id })
          .from(channels)
          .where(and(eq(channels.id, input.channelId), eq(channels.userId, ctx.user.id)))
          .limit(1);
        if (!channel) throw new TRPCError({ code: "NOT_FOUND" });
        await assertProjectOwner(ctx.user.id, input.projectId, channel.id);
        const [created] = await db
          .insert(poetCustomTopics)
          .values({
            channelId: channel.id,
            projectId: input.projectId,
            topic: input.topic,
            references: input.references.map((r) => ({
              kind: r.kind,
              url: r.url,
              text: r.text,
              title: r.title,
            })),
            language: input.language,
            sourceIdeaId: input.sourceIdeaId ?? null,
            status: "draft",
          })
          .returning();
        return created!;
      }),

    updateCustomTopic: protectedProcedure
      .input(updateCustomTopicInput)
      .mutation(async ({ ctx, input }) => {
        const [updated] = await db
          .update(poetCustomTopics)
          .set({
            topic: input.topic ?? undefined,
            references: input.references
              ? input.references.map((r) => ({
                  kind: r.kind,
                  url: r.url,
                  text: r.text,
                  title: r.title,
                }))
              : undefined,
            language: input.language ?? undefined,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(poetCustomTopics.id, input.topicId),
              inArray(
                poetCustomTopics.channelId,
                db
                  .select({ id: channels.id })
                  .from(channels)
                  .where(eq(channels.userId, ctx.user.id)),
              ),
            ),
          )
          .returning();
        if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
        return updated;
      }),

    deleteCustomTopic: protectedProcedure
      .input(deleteCustomTopicInput)
      .mutation(async ({ ctx, input }) => {
        const [deleted] = await db
          .delete(poetCustomTopics)
          .where(
            and(
              eq(poetCustomTopics.id, input.topicId),
              inArray(
                poetCustomTopics.channelId,
                db
                  .select({ id: channels.id })
                  .from(channels)
                  .where(eq(channels.userId, ctx.user.id)),
              ),
            ),
          )
          .returning({ id: poetCustomTopics.id });
        return { id: deleted?.id ?? null };
      }),

    analyzeCustomTopic: protectedProcedure
      .input(analyzeCustomTopicInput)
      .mutation(async ({ ctx, input }) => {
        const [channel] = await db
          .select({ id: channels.id })
          .from(channels)
          .where(and(eq(channels.id, input.channelId), eq(channels.userId, ctx.user.id)))
          .limit(1);
        if (!channel) throw new TRPCError({ code: "NOT_FOUND" });
        await assertProjectOwner(ctx.user.id, input.projectId, channel.id);

        const [activeBible] = await db
          .select({ id: poetBible.id })
          .from(poetBible)
          .where(and(eq(poetBible.channelId, channel.id), eq(poetBible.isActive, true)))
          .limit(1);
        if (!activeBible) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "请先生成并激活一份频道圣经",
          });
        }

        const [topic] = await db
          .select({ id: poetCustomTopics.id })
          .from(poetCustomTopics)
          .where(
            and(eq(poetCustomTopics.id, input.topicId), eq(poetCustomTopics.projectId, input.projectId)),
          )
          .limit(1);
        if (!topic) throw new TRPCError({ code: "NOT_FOUND", message: "自定义选题不存在" });

        await assertNoActiveRun(channel.id, "poet");

        return stageAndTriggerRun({
          userId: ctx.user.id,
          owner: { channelId: channel.id },
          projectId: input.projectId,
          agent: "poet",
          taskId: "poet-analyze-custom-topic",
          config: { kind: "analyze", topicId: input.topicId, language: input.language },
          payload: { topicId: input.topicId, language: input.language },
        });
      }),

    deleteBible: protectedProcedure
      .input(deleteBibleInput)
      .mutation(async ({ ctx, input }) => {
        const [existing] = await db
          .select({ id: poetBible.id, isActive: poetBible.isActive })
          .from(poetBible)
          .innerJoin(channels, eq(channels.id, poetBible.channelId))
          .where(and(eq(poetBible.id, input.bibleId), eq(channels.userId, ctx.user.id)))
          .limit(1);
        if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
        if (existing.isActive) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "无法删除生效中的圣经，请先激活另一份后再删",
          });
        }
        const [deleted] = await db
          .delete(poetBible)
          .where(eq(poetBible.id, input.bibleId))
          .returning({ id: poetBible.id });
        return { id: deleted?.id ?? null };
      }),

    deleteScript: protectedProcedure
      .input(deleteScriptInput)
      .mutation(async ({ ctx, input }) => {
        const [existing] = await db
          .select({
            id: poetScripts.id,
            ideaId: poetScripts.ideaId,
            customTopicId: poetScripts.customTopicId,
          })
          .from(poetScripts)
          .innerJoin(channels, eq(channels.id, poetScripts.channelId))
          .where(and(eq(poetScripts.id, input.scriptId), eq(channels.userId, ctx.user.id)))
          .limit(1);
        if (!existing) throw new TRPCError({ code: "NOT_FOUND" });

        await db.delete(poetScripts).where(eq(poetScripts.id, input.scriptId));

        // Reset source status so the user can re-generate from the same idea / topic.
        if (existing.ideaId) {
          await db
            .update(museIdeas)
            .set({ scripted: false })
            .where(eq(museIdeas.id, existing.ideaId));
        }
        if (existing.customTopicId) {
          await db
            .update(poetCustomTopics)
            .set({ status: "analyzed", updatedAt: new Date() })
            .where(eq(poetCustomTopics.id, existing.customTopicId));
        }
        return { id: existing.id };
      }),

    generateScriptFromCustomTopic: protectedProcedure
      .input(generateScriptFromCustomTopicInput)
      .mutation(async ({ ctx, input }) => {
        const [channel] = await db
          .select({ id: channels.id })
          .from(channels)
          .where(and(eq(channels.id, input.channelId), eq(channels.userId, ctx.user.id)))
          .limit(1);
        if (!channel) throw new TRPCError({ code: "NOT_FOUND" });
        await assertProjectOwner(ctx.user.id, input.projectId, channel.id);

        const [activeBible] = await db
          .select({ id: poetBible.id })
          .from(poetBible)
          .where(and(eq(poetBible.channelId, channel.id), eq(poetBible.isActive, true)))
          .limit(1);
        if (!activeBible) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "请先生成并激活一份频道圣经",
          });
        }

        const [topic] = await db
          .select({ id: poetCustomTopics.id, status: poetCustomTopics.status })
          .from(poetCustomTopics)
          .where(
            and(
              eq(poetCustomTopics.id, input.topicId),
              eq(poetCustomTopics.projectId, input.projectId),
            ),
          )
          .limit(1);
        if (!topic) throw new TRPCError({ code: "NOT_FOUND", message: "自定义选题不存在" });
        if (topic.status !== "analyzed" && topic.status !== "scripted") {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "请先分析该自定义选题再开始写稿",
          });
        }

        await assertNoActiveRun(channel.id, "poet");

        const chargeDuration =
          input.durationSeconds ??
          (input.projectId
            ? (
                await db
                  .select({ d: projects.targetDurationSeconds })
                  .from(projects)
                  .where(eq(projects.id, input.projectId))
                  .limit(1)
              )[0]?.d
            : undefined);

        return stageAndTriggerRun({
          userId: ctx.user.id,
          quotaMinutes: scriptMinutes(chargeDuration),
          owner: { channelId: channel.id },
          projectId: input.projectId,
          agent: "poet",
          taskId: "poet-generate-script",
          config: {
            kind: "script",
            customTopicId: input.topicId,
            language: input.language,
            durationSeconds: input.durationSeconds,
          },
          payload: {
            customTopicId: input.topicId,
            language: input.language,
            durationSeconds: input.durationSeconds,
          },
        });
      }),
  }),

  projects: router({
    create: protectedProcedure
      .input(createProjectInput)
      .mutation(async ({ ctx, input }) => {
        const [account] = await db
          .select({ id: channels.id, platform: channels.platform })
          .from(channels)
          .where(and(eq(channels.slug, input.accountSlug), eq(channels.userId, ctx.user.id)))
          .limit(1);
        if (!account) throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });

        const base = slugify(input.name);
        let slug = base;
        let suffix = 1;
        while (true) {
          const [clash] = await db
            .select({ id: projects.id })
            .from(projects)
            .where(and(eq(projects.ownAccountId, account.id), eq(projects.slug, slug)))
            .limit(1);
          if (!clash) break;
          suffix++;
          slug = `${base}-${suffix}`;
        }

        const [created] = await db
          .insert(projects)
          .values({
            ownAccountId: account.id,
            userId: ctx.user.id,
            name: input.name,
            slug,
            platform: account.platform,
            description: input.description ?? null,
          })
          .returning();
        if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        return created;
      }),

    // Rename only — slug is left intact to keep the /projects/[project] URL stable.
    update: protectedProcedure
      .input(updateProjectInput)
      .mutation(async ({ ctx, input }) => {
        await assertProjectOwner(ctx.user.id, input.projectId);
        const [updated] = await db
          .update(projects)
          .set({ name: input.name, description: input.description ?? null, updatedAt: new Date() })
          .where(eq(projects.id, input.projectId))
          .returning();
        if (!updated) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        return updated;
      }),

    delete: protectedProcedure
      .input(deleteProjectInput)
      .mutation(async ({ ctx, input }) => {
        await assertProjectOwner(ctx.user.id, input.projectId);
        const [proj] = await db
          .select({ id: projects.id, ownAccountId: projects.ownAccountId })
          .from(projects)
          .where(eq(projects.id, input.projectId))
          .limit(1);
        if (!proj) throw new TRPCError({ code: "NOT_FOUND" });
        if (proj.id === proj.ownAccountId) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "默认项目不能删除，请直接删除账号",
          });
        }
        const [deleted] = await db
          .delete(projects)
          .where(eq(projects.id, input.projectId))
          .returning({ id: projects.id });
        return { id: deleted?.id ?? null };
      }),

    listForPicker: protectedProcedure.query(async ({ ctx }) => {
      return db
        .select({
          id: projects.id,
          name: projects.name,
          accountSlug: channels.slug,
          accountName: channels.name,
        })
        .from(projects)
        .innerJoin(channels, eq(channels.id, projects.ownAccountId))
        .where(eq(projects.userId, ctx.user.id))
        .orderBy(channels.name, projects.createdAt);
    }),
  }),
});

export type AppRouter = typeof appRouter;
