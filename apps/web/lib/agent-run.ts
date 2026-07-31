import "server-only";

import { and, desc, eq, gte, inArray, isNull, or } from "drizzle-orm";
import { auth } from "@trigger.dev/sdk";

import { channels, competitorAccounts, pipelineRuns } from "@goooose/db";

import { db } from "./db";

export type ActiveAgentRunRow = {
  runId: string;
  triggerRunId: string;
  command: string;
  startedAt: Date;
};

export type ActiveAgentRun = ActiveAgentRunRow & { publicAccessToken: string };

export type AgentRunOwner = { channelId: string } | { competitorAccountId: string };

// Minting is a blocking hkg1 -> Trigger.dev round trip, so the lookup is separate: a page that
// needs the run only to decide whether something else is holding the lock must not pay for it.
export async function attachRealtimeToken(row: ActiveAgentRunRow): Promise<ActiveAgentRun> {
  const publicAccessToken = await auth.createPublicToken({
    scopes: { read: { runs: [row.triggerRunId] } },
    expirationTime: "1h",
  });
  return { ...row, publicAccessToken };
}

export async function findActiveAgentRun(
  owner: string | AgentRunOwner,
  userId: string,
  agent: "clerk" | "muse" | "poet",
  // clerk has two commands; the channel panel must not reattach to a single-video run.
  command?: string,
  // Bible runs carry no projectId, so strict equality would hide them from the Poet page.
  projectId?: string,
): Promise<ActiveAgentRunRow | null> {
  const ownerObj: AgentRunOwner = typeof owner === "string" ? { channelId: owner } : owner;
  const ownerCond =
    "channelId" in ownerObj
      ? eq(pipelineRuns.channelId, ownerObj.channelId)
      : eq(pipelineRuns.competitorAccountId, ownerObj.competitorAccountId);
  const [active] = await db
    .select({
      id: pipelineRuns.id,
      configJson: pipelineRuns.configJson,
      command: pipelineRuns.command,
      startedAt: pipelineRuns.startedAt,
    })
    .from(pipelineRuns)
    .leftJoin(channels, eq(channels.id, pipelineRuns.channelId))
    .leftJoin(competitorAccounts, eq(competitorAccounts.id, pipelineRuns.competitorAccountId))
    .where(
      and(
        ownerCond,
        or(eq(channels.userId, userId), eq(competitorAccounts.userId, userId)),
        eq(pipelineRuns.agent, agent),
        ...(command ? [eq(pipelineRuns.command, command)] : []),
        ...(projectId
          ? [or(eq(pipelineRuns.projectId, projectId), isNull(pipelineRuns.projectId))!]
          : []),
        inArray(pipelineRuns.status, ["pending", "running"]),
        // Must match assertNoActiveRun's 30-min orphan cutoff, or stale pending rows
        // (failed trigger, seeded row) show as active forever.
        or(
          eq(pipelineRuns.status, "running"),
          gte(pipelineRuns.startedAt, new Date(Date.now() - 30 * 60 * 1000)),
        ),
      ),
    )
    .orderBy(desc(pipelineRuns.startedAt))
    .limit(1);

  if (!active) return null;
  const triggerRunId = (active.configJson as { triggerRunId?: string } | null)?.triggerRunId;
  if (!triggerRunId) return null;

  return {
    runId: active.id,
    triggerRunId,
    command: active.command,
    startedAt: active.startedAt,
  };
}

export async function getActiveAgentRun(
  owner: string | AgentRunOwner,
  userId: string,
  agent: "clerk" | "muse" | "poet",
  command?: string,
  projectId?: string,
): Promise<ActiveAgentRun | null> {
  const row = await findActiveAgentRun(owner, userId, agent, command, projectId);
  return row ? attachRealtimeToken(row) : null;
}
