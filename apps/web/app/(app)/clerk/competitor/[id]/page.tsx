import { and, desc, eq, isNull } from "drizzle-orm";
import { notFound } from "next/navigation";

import { clerkSops, clerkVideos, competitorAccounts } from "@goooose/db";

import { BackLink } from "@/components/back-link";
import { Badge } from "@/components/ui/badge";
import { CompetitorAvatar } from "@/components/competitor-avatar";
import { RefreshCompetitorButton } from "@/components/refresh-competitor-button";
import { ContentTypeBadge } from "../../_components/content-type-badge";
import { ResetTargetButton } from "../../_components/reset-target-button";
import { SingleVideoSopButton } from "../../_components/single-video-sop-button";
import { SopCard } from "../../_components/sop-card";
import { TranscriptSourceBadge } from "../../_components/transcript-source-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { followerNoun, formatDuration, formatFollowerCount, formatViews } from "@/lib/format-count";
import { PLATFORM_CONTENT_UNIT, PLATFORM_LABEL, PLATFORM_METRIC_LABEL } from "@/lib/platform";
import { getActiveAgentRun } from "@/lib/agent-run";
import { xhsGoHref } from "@/lib/xhs-go";
import { formatDateTime } from "@/lib/datetime";
import { db } from "@/lib/db";
import { cleanProfileName } from "@/lib/display-name";
import { ensureCurrentUser } from "@/lib/users";

import { ClerkRunButton } from "../../[slug]/_components/clerk-run-button";

type Props = { params: Promise<{ id: string }> };

export default async function ClerkCompetitorPage({ params }: Props) {
  const { id } = await params;

  const user = await ensureCurrentUser();
  if (!user) return null;

  const [competitor] = await db
    .select()
    .from(competitorAccounts)
    .where(
      and(
        eq(competitorAccounts.id, id),
        eq(competitorAccounts.userId, user.id),
        isNull(competitorAccounts.deletedAt),
      ),
    )
    .limit(1);
  if (!competitor) notFound();

  const isXhs = competitor.platform === "xhs";
  const unit = PLATFORM_CONTENT_UNIT[competitor.platform];
  const itemUnit = `${unit.measure}${unit.noun}`;
  const itemNoun = unit.noun;
  const [videos, sops, activeRun, clerkLock] = await Promise.all([
    db
      .select()
      .from(clerkVideos)
      .where(eq(clerkVideos.competitorAccountId, competitor.id))
      .orderBy(desc(clerkVideos.views)),
    db
      .select()
      .from(clerkSops)
      .where(eq(clerkSops.competitorAccountId, competitor.id))
      .orderBy(desc(clerkSops.generatedAt)),
    getActiveAgentRun({ competitorAccountId: competitor.id }, user.id, "clerk", "clerk-analyze-channel"),
    getActiveAgentRun({ competitorAccountId: competitor.id }, user.id, "clerk"),
  ]);

  const sopOrder: Record<string, number> = { human: 0, hottest: 1, single_video: 2, ai_reference: 3 };
  const sortedSops = [...sops].sort(
    (a, b) => (sopOrder[a.sopType] ?? 99) - (sopOrder[b.sopType] ?? 99),
  );
  const primarySops = sortedSops.filter(
    (s) => s.sopType !== "ai_reference" && s.sopType !== "single_video",
  );
  const singleVideoSops = sortedSops.filter((s) => s.sopType === "single_video");
  const aiReferenceSops = sortedSops.filter((s) => s.sopType === "ai_reference");
  const name = cleanProfileName(competitor.name ?? competitor.url);
  // Legacy hottest rows (no videoId) dissected the top-viewed video = videos[0].
  const videoTitleById = new Map(videos.map((v) => [v.id, v.title]));
  const sourceTitleOf = (sop: (typeof sops)[number]) =>
    (sop.videoId ? videoTitleById.get(sop.videoId) : undefined) ??
    (sop.sopType === "hottest" ? videos[0]?.title : undefined);

  return (
    <div className="flex w-full min-w-0 flex-1 flex-col gap-6 p-6 sm:p-8">
      <BackLink href="/clerk" label="Clerk · 分析师" />

      <header className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <CompetitorAvatar name={competitor.name} avatarUrl={competitor.avatarUrl} className="size-9" />
          <div className="flex min-w-0 flex-col">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate text-2xl font-semibold tracking-tight">{name} 的账号画像</h1>
              <Badge variant="outline" className="shrink-0 text-[10px]">
                🎯 对标账号
              </Badge>
            </div>
            <span className="text-xs text-muted-foreground">
              {PLATFORM_LABEL[competitor.platform]}
              {competitor.subscriberCount != null
                ? ` · ${formatFollowerCount(competitor.subscriberCount)} ${followerNoun(competitor.platform)}`
                : ""}
              {competitor.lastVerifiedAt ? ` · 数据更新于 ${formatDateTime(competitor.lastVerifiedAt)}` : ""}
              {" · "}
              <a href={competitor.url} target="_blank" rel="noopener noreferrer" className="font-mono hover:text-foreground">
                {competitor.url.slice(0, 60)}
              </a>
            </span>
          </div>
          <Badge variant="secondary" className="shrink-0 font-mono text-[10px]">
            {videos.length} {itemUnit}
          </Badge>
          {primarySops.length > 0 ? (
            <Badge variant="secondary" className="shrink-0 font-mono text-[10px]">
              {primarySops.length} 份 SOP
            </Badge>
          ) : null}
        </div>
        <RefreshCompetitorButton competitorAccountId={competitor.id} />
      </header>

      <ClerkRunButton
        target={{ kind: "competitor", competitorAccountId: competitor.id }}
        channelName={name}
        platform={competitor.platform}
        initialActive={activeRun}
        lockedByOtherRun={!activeRun && !!clerkLock}
      />

      {videos.length > 0 ? (
        <div className="flex justify-end">
          <ResetTargetButton
            target={{ kind: "competitor", competitorAccountId: competitor.id }}
            name={name}
          />
        </div>
      ) : null}

      {videos.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-card/40 p-10 text-sm text-muted-foreground">
          <span>还没拆解过这个对标</span>
          <span className="text-xs">
            点上方「开始分析」— Clerk 会拆解 TA 的{itemNoun}，沉淀出可复用的 SOP
          </span>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>标题</TableHead>
                <TableHead className="w-20">类型</TableHead>
                <TableHead className="w-24">{isXhs ? "文本来源" : "字幕来源"}</TableHead>
                <TableHead className="hidden w-28 md:table-cell">开场钩子</TableHead>
                <TableHead className="w-20">{PLATFORM_METRIC_LABEL[competitor.platform]}</TableHead>
                <TableHead className="w-20">时长</TableHead>
                <TableHead className="hidden w-28 md:table-cell">分析时间</TableHead>
                <TableHead className="w-28 text-right">单条拆解</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {videos.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="max-w-md truncate font-medium">
                    <a
                      href={xhsGoHref(v.url)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-foreground hover:underline"
                    >
                      {v.title}
                    </a>
                  </TableCell>
                  <TableCell>
                    <ContentTypeBadge contentType={v.contentType} />
                  </TableCell>
                  <TableCell>
                    <TranscriptSourceBadge source={v.transcriptSource} hasTranscript={!!v.transcript} />
                  </TableCell>
                  <TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell">
                    {v.openingHookType ?? "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs font-semibold text-foreground">
                    {formatViews(v.views)}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {v.contentType.endsWith("_image") ? "图文" : formatDuration(v.durationSec)}
                  </TableCell>
                  <TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell">
                    {formatDateTime(v.analyzedAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <SingleVideoSopButton
                      videoId={v.id}
                      hasTranscript={!!v.transcript}
                      isImagePost={v.contentType.endsWith("_image")}
                      blockedReason={clerkLock ? "该账号有分析任务在运行，完成后再拆解单条" : undefined}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {primarySops.length > 0 ? (
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-medium text-muted-foreground">脚本撰写 SOP</h2>
            <p className="text-xs text-muted-foreground">
              SOP 是这个账号全部拆解的实时汇总（基于 {videos.length} 条{itemNoun}），每次分析后自动刷新到最新。
            </p>
          </div>
          <div className="flex flex-col gap-4">
            {primarySops.map((sop) => (
              <SopCard key={sop.id} sop={sop} sourceName={name} showDelete sourceVideoTitle={sourceTitleOf(sop)} />
            ))}
          </div>
          <div className="rounded-lg border-2 border-dashed border-poet/40 bg-poet/5 p-4 text-sm">
            <span className="font-medium">SOP 已进库。</span>
            <span className="text-muted-foreground">
              去任意项目主页的「写稿 SOP · 更换」里选用这份打法，Poet 写稿就会按它来。
            </span>
          </div>
        </section>
      ) : null}

      {singleVideoSops.length > 0 ? (
        <details className="flex flex-col gap-3 rounded-lg border bg-card/50 p-4 text-sm" open>
          <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">
            单条拆解 SOP（{singleVideoSops.length}）· 针对单条{itemNoun}的深度拆解
          </summary>
          <div className="mt-3 flex flex-col gap-4">
            {singleVideoSops.map((sop) => (
              <SopCard key={sop.id} sop={sop} sourceName={name} showDelete sourceVideoTitle={sourceTitleOf(sop)} />
            ))}
          </div>
        </details>
      ) : null}

      {aiReferenceSops.length > 0 ? (
        <details className="flex flex-col gap-3 rounded-lg border bg-card/50 p-4 text-sm">
          <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">
            AI 底稿（默认隐藏 · 给 AI 用，非给人读 · 写稿选用的就是这类）
          </summary>
          <div className="mt-3 flex flex-col gap-4">
            {aiReferenceSops.map((sop) => (
              <SopCard key={sop.id} sop={sop} sourceName={name} showDelete />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

