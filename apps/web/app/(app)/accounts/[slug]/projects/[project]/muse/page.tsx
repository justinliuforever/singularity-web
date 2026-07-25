import { and, count, desc, eq, isNull } from "drizzle-orm";
import Link from "next/link";
import { ExternalLink } from "lucide-react";

import {
  competitorAccounts,
  museIdeas,
  museMonitorVideos,
  projectCompetitors,
} from "@goooose/db";

import { Badge } from "@/components/ui/badge";
import { BackLink } from "@/components/back-link";
import { Button } from "@/components/ui/button";
import { CompetitorAvatar } from "@/components/competitor-avatar";
import { followerNoun, formatFollowerCount } from "@/lib/format-count";
import { PLATFORM_LABEL } from "@/lib/platform";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getActiveAgentRun } from "@/lib/agent-run";
import { xhsGoHref } from "@/lib/xhs-go";
import { db } from "@/lib/db";
import { resolveOwnedProject } from "@/lib/account-access";

import { IdeaActions } from "./_components/idea-actions";
import { PendingIdeaTree, type PendingGroup } from "./_components/idea-tree";
import { MuseRunButton } from "./_components/muse-run-button";
import {
  MuseRunProgressPanel,
  type LastProcessed,
  type LiveStats,
} from "./_components/muse-run-progress-panel";

type Props = { params: Promise<{ slug: string; project: string }> };

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default async function MuseChannelPage({ params }: Props) {
  const { slug: rawSlug, project: rawProject } = await params;
  const slug = decodeURIComponent(rawSlug);
  const projectSlug = decodeURIComponent(rawProject);

  const { user, channel, project } = await resolveOwnedProject(slug, projectSlug);

  const [monitored, ideas, activeRun, accountMuseLock, boundCompetitors] = await Promise.all([
    db
      .select()
      .from(museMonitorVideos)
      .where(eq(museMonitorVideos.projectId, project.id))
      .orderBy(desc(museMonitorVideos.processedAt)),
    db
      .select({
        id: museIdeas.id,
        ideaNumber: museIdeas.ideaNumber,
        storyAngle: museIdeas.storyAngle,
        factsAndData: museIdeas.factsAndData,
        whySimilar: museIdeas.whySimilar,
        viralTrigger: museIdeas.viralTrigger,
        coverConcept: museIdeas.coverConcept,
        suggestedHookType: museIdeas.suggestedHookType,
        riskFactors: museIdeas.riskFactors,
        approved: museIdeas.approved,
        scripted: museIdeas.scripted,
        dismissedAt: museIdeas.dismissedAt,
        generatedAt: museIdeas.generatedAt,
        runId: museIdeas.runId,
        sourceVideoId: museIdeas.sourceVideoId,
        sourceTitle: museMonitorVideos.title,
        sourceUrl: museMonitorVideos.url,
        sourceChannelName: museMonitorVideos.sourceChannelName,
      })
      .from(museIdeas)
      .leftJoin(museMonitorVideos, eq(museMonitorVideos.id, museIdeas.sourceVideoId))
      .where(eq(museIdeas.projectId, project.id))
      .orderBy(desc(museIdeas.generatedAt)),
    getActiveAgentRun(channel.id, user.id, "muse", undefined, project.id),
    // The server lock is account-wide, so a sibling project's run still blocks starting here.
    getActiveAgentRun(channel.id, user.id, "muse"),
    db
      .select({
        id: competitorAccounts.id,
        name: competitorAccounts.name,
        url: competitorAccounts.url,
        platform: competitorAccounts.platform,
        avatarUrl: competitorAccounts.avatarUrl,
        subscriberCount: competitorAccounts.subscriberCount,
      })
      .from(projectCompetitors)
      .innerJoin(competitorAccounts, eq(competitorAccounts.id, projectCompetitors.competitorAccountId))
      .where(and(eq(projectCompetitors.projectId, project.id), isNull(competitorAccounts.deletedAt))),
  ]);

  const activeCompetitorCount = boundCompetitors.length;

  const pendingIdeas = ideas.filter((i) => !i.approved && !i.scripted && i.dismissedAt == null);
  const adoptedIdeas = ideas.filter((i) => (i.approved || i.scripted) && i.dismissedAt == null);
  const dismissedIdeas = ideas.filter((i) => i.dismissedAt != null);
  const undismissedCount = ideas.filter((i) => i.dismissedAt == null).length;
  const approvedUnscripted = ideas.filter(
    (i) => i.approved && !i.scripted && i.dismissedAt == null,
  ).length;

  // 待处理 groups by source video (mind-map tree); groups touched by the newest run get a badge.
  const newestRunId = activeRun?.runId ?? pendingIdeas[0]?.runId ?? null;
  const pendingGroups: PendingGroup[] = [];
  const groupByKey = new Map<string, PendingGroup>();
  for (const idea of pendingIdeas) {
    const key = idea.sourceVideoId ?? "unknown";
    let group = groupByKey.get(key);
    if (!group) {
      group = {
        key,
        sourceTitle: idea.sourceTitle,
        sourceUrl: idea.sourceUrl,
        sourceChannelName: idea.sourceChannelName,
        isLatestRun: false,
        ideas: [],
      };
      groupByKey.set(key, group);
      pendingGroups.push(group);
    }
    group.ideas.push(idea);
    if (idea.runId === newestRunId) group.isLatestRun = true;
  }

  let liveStats: LiveStats | null = null;
  let lastProcessed: LastProcessed = null;
  if (activeRun) {
    const [allMon, relMon, irrMon, runIdeas, lastRow] = await Promise.all([
      db
        .select({ c: count() })
        .from(museMonitorVideos)
        .where(
          and(
            eq(museMonitorVideos.projectId, project.id),
            eq(museMonitorVideos.runId, activeRun.runId),
          ),
        ),
      db
        .select({ c: count() })
        .from(museMonitorVideos)
        .where(
          and(
            eq(museMonitorVideos.projectId, project.id),
            eq(museMonitorVideos.runId, activeRun.runId),
            eq(museMonitorVideos.relevant, true),
          ),
        ),
      db
        .select({ c: count() })
        .from(museMonitorVideos)
        .where(
          and(
            eq(museMonitorVideos.projectId, project.id),
            eq(museMonitorVideos.runId, activeRun.runId),
            eq(museMonitorVideos.relevant, false),
          ),
        ),
      db
        .select({ c: count() })
        .from(museIdeas)
        .where(
          and(
            eq(museIdeas.projectId, project.id),
            eq(museIdeas.runId, activeRun.runId),
          ),
        ),
      db
        .select({
          title: museMonitorVideos.title,
          sourceChannelName: museMonitorVideos.sourceChannelName,
          relevant: museMonitorVideos.relevant,
          topicClassification: museMonitorVideos.topicClassification,
          transcript: museMonitorVideos.transcript,
        })
        .from(museMonitorVideos)
        .where(
          and(
            eq(museMonitorVideos.projectId, project.id),
            eq(museMonitorVideos.runId, activeRun.runId),
          ),
        )
        .orderBy(desc(museMonitorVideos.processedAt))
        .limit(1),
    ]);
    liveStats = {
      monitored: allMon[0]?.c ?? 0,
      relevant: relMon[0]?.c ?? 0,
      irrelevant: irrMon[0]?.c ?? 0,
      ideas: runIdeas[0]?.c ?? 0,
    };
    const r = lastRow[0];
    if (r) {
      lastProcessed = {
        title: r.title,
        sourceChannelName: r.sourceChannelName,
        relevant: r.relevant,
        topicClassification: r.topicClassification,
        transcriptLength: r.transcript?.length ?? 0,
      };
    }
  }

  return (
    <div className="flex w-full min-w-0 flex-1 flex-col gap-8 p-6 sm:p-8">
      <BackLink href={`/accounts/${encodeURIComponent(slug)}/projects/${encodeURIComponent(projectSlug)}`} label="项目" />

      <header className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="size-2 rounded-full bg-muse" />
          <h1 className="text-2xl font-semibold tracking-tight">{channel.name}</h1>
          <Badge variant="secondary" className="font-mono text-[10px]">
            {undismissedCount} 个选题
          </Badge>
          <Badge variant="secondary" className="font-mono text-[10px]">
            {activeCompetitorCount} 个对标账号
          </Badge>
          {approvedUnscripted > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              render={
                <Link
                  href={`/accounts/${encodeURIComponent(slug)}/projects/${encodeURIComponent(projectSlug)}/poet`}
                />
              }
            >
              {approvedUnscripted} 个待写 · 去 Poet
            </Button>
          ) : null}
        </div>
        <MuseRunButton
          channelId={channel.id}
          projectId={project.id}
          channelName={channel.name}
          competitors={boundCompetitors}
          isActive={!!accountMuseLock}
          accountSlug={slug}
          projectSlug={projectSlug}
        />
      </header>

      {boundCompetitors.length > 0 ? (
        <section className="flex flex-col gap-2 rounded-lg border bg-card/50 p-4">
          <h2 className="text-xs font-medium text-muted-foreground">
            巡视对象 — Muse 监控的是这些对标账号的内容，不是你自己的账号
          </h2>
          <div className="flex flex-wrap gap-2">
            {boundCompetitors.map((c) => (
              <span
                key={c.id}
                className="inline-flex items-center gap-2 rounded-full border bg-card py-1 pr-3 pl-1 text-xs"
              >
                <CompetitorAvatar name={c.name} avatarUrl={c.avatarUrl} className="size-6" />
                <span className="flex flex-col leading-tight">
                  <span className="max-w-[160px] truncate font-medium">{c.name ?? c.url}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {PLATFORM_LABEL[c.platform]}
                    {c.subscriberCount != null
                      ? ` · ${formatFollowerCount(c.subscriberCount)} ${followerNoun(c.platform)}`
                      : ""}
                  </span>
                </span>
              </span>
            ))}
          </div>
        </section>
      ) : null}

      {activeRun ? (
        <MuseRunProgressPanel
          runId={activeRun.runId}
          triggerRunId={activeRun.triggerRunId}
          accessToken={activeRun.publicAccessToken}
          startedAt={activeRun.startedAt ?? null}
          liveStats={liveStats ?? { monitored: 0, relevant: 0, irrelevant: 0, ideas: 0 }}
          lastProcessed={lastProcessed}
        />
      ) : null}

      {monitored.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">已巡视视频</h2>
          <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>标题</TableHead>
                <TableHead className="w-40">对标账号</TableHead>
                <TableHead className="hidden w-20 md:table-cell">时长</TableHead>
                <TableHead className="w-24">相关性</TableHead>
                <TableHead className="hidden w-32 md:table-cell">分类</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {monitored.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="max-w-md truncate">
                    <a
                      href={xhsGoHref(v.url)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 hover:text-foreground"
                    >
                      {v.title}
                      <ExternalLink className="size-3" />
                    </a>
                  </TableCell>
                  <TableCell className="truncate text-sm text-muted-foreground">
                    {v.sourceChannelName ?? "—"}
                  </TableCell>
                  <TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell">
                    {formatDuration(v.durationSec)}
                  </TableCell>
                  <TableCell>
                    {v.relevant === null ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : v.relevant ? (
                      <Badge variant="secondary" className="text-[10px]">
                        相关
                      </Badge>
                    ) : (
                      <span className="font-mono text-[10px] text-muted-foreground">
                        已排除
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="hidden truncate text-xs text-muted-foreground md:table-cell">
                    {v.topicClassification ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        </section>
      ) : null}

      {ideas.length > 0 ? (
        <>
          <section id="muse-ideas" className="flex scroll-mt-20 flex-col gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium text-muted-foreground">待处理</h2>
              <Badge variant="secondary" className="font-mono text-[10px]">
                {pendingIdeas.length}
              </Badge>
            </div>
            {pendingIdeas.length === 0 ? (
              <span className="text-xs text-muted-foreground">待处理选题已清空</span>
            ) : (
              <PendingIdeaTree
                groups={pendingGroups}
                accountSlug={slug}
                projectSlug={projectSlug}
              />
            )}
          </section>

          {adoptedIdeas.length > 0 ? (
            <details className="flex flex-col gap-3">
              <summary className="cursor-pointer text-sm font-medium text-muted-foreground list-none [&::-webkit-details-marker]:hidden">
                已采用 · {adoptedIdeas.length}
              </summary>
              <div className="mt-3 flex flex-col gap-2">
                {adoptedIdeas.map((idea) => (
                  <div
                    key={idea.id}
                    className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">#{idea.ideaNumber}</span>
                      <span className="truncate text-sm line-clamp-1">{idea.storyAngle ?? "—"}</span>
                    </div>
                    <IdeaActions
                      ideaId={idea.id}
                      state={idea.scripted ? "scripted" : "adopted"}
                      accountSlug={slug}
                      projectSlug={projectSlug}
                    />
                  </div>
                ))}
              </div>
            </details>
          ) : null}

          {dismissedIdeas.length > 0 ? (
            <details className="flex flex-col gap-3">
              <summary className="cursor-pointer text-sm font-medium text-muted-foreground list-none [&::-webkit-details-marker]:hidden">
                已忽略 · {dismissedIdeas.length}
              </summary>
              <div className="mt-3 flex flex-col gap-2">
                {dismissedIdeas.map((idea) => (
                  <div
                    key={idea.id}
                    className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3 opacity-60"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">#{idea.ideaNumber}</span>
                      <span className="truncate text-sm line-clamp-1">{idea.storyAngle ?? "—"}</span>
                    </div>
                    <IdeaActions
                      ideaId={idea.id}
                      state="dismissed"
                      accountSlug={slug}
                      projectSlug={projectSlug}
                    />
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </>
      ) : monitored.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-sm text-muted-foreground">
          <span>还没有选题</span>
          {activeCompetitorCount > 0 ? (
            <span className="text-xs">
              点击右上角「开始巡视」— Muse 会扫描上方对标账号的最新内容，提取爆款机制，为你的频道生成选题
            </span>
          ) : (
            <>
              <span className="text-xs">
                还没有绑定对标 — 也可以点「开始巡视」直接指定内容链接分析
              </span>
              <Button
                size="sm"
                variant="outline"
                render={
                  <Link
                    href={`/accounts/${encodeURIComponent(slug)}/projects/${encodeURIComponent(projectSlug)}`}
                  />
                }
              >
                去绑定对标
              </Button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
