import { desc, eq } from "drizzle-orm";
import Link from "next/link";

import { channelSeries, clerkSops, clerkVideos } from "@goooose/db";

import { Badge } from "@/components/ui/badge";
import { formatDuration, formatViews } from "@/lib/format-count";
import { BackLink } from "@/components/back-link";
import { Button } from "@/components/ui/button";
import { ContentTypeBadge } from "../_components/content-type-badge";
import { ResetTargetButton } from "../_components/reset-target-button";
import { SingleVideoSopButton } from "../_components/single-video-sop-button";
import { SopCard } from "../_components/sop-card";
import { TranscriptSourceBadge } from "../_components/transcript-source-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getActiveAgentRun } from "@/lib/agent-run";
import { formatDateTime } from "@/lib/datetime";
import { db } from "@/lib/db";
import { cleanProfileName } from "@/lib/display-name";
import { PLATFORM_CONTENT_UNIT, PLATFORM_METRIC_LABEL } from "@/lib/platform";
import { resolveOwnedChannel } from "@/lib/account-access";


import { ClerkRunButton } from "./_components/clerk-run-button";
import { ClerkSeriesPanel } from "./_components/clerk-series-panel";

type Props = { params: Promise<{ slug: string }> };

export default async function ClerkChannelPage({ params }: Props) {
  const { slug: rawSlug } = await params;
  const slug = decodeURIComponent(rawSlug);

  const { user, channel } = await resolveOwnedChannel(slug);

  const isXhs = channel.platform === "xhs";
  const unit = PLATFORM_CONTENT_UNIT[channel.platform];
  const itemUnit = `${unit.measure}${unit.noun}`;
  const itemNoun = unit.noun;

  const [videos, sops, activeRun, clerkLock, seriesRows] = await Promise.all([
    db
      .select()
      .from(clerkVideos)
      .where(eq(clerkVideos.channelId, channel.id))
      .orderBy(desc(clerkVideos.views)),
    db
      .select()
      .from(clerkSops)
      .where(eq(clerkSops.channelId, channel.id))
      .orderBy(desc(clerkSops.generatedAt)),
    getActiveAgentRun(channel.id, user.id, "clerk", "clerk-analyze-channel"),
    getActiveAgentRun(channel.id, user.id, "clerk"),
    channel.platform === "youtube"
      ? db
          .select()
          .from(channelSeries)
          .where(eq(channelSeries.channelId, channel.id))
          .orderBy(desc(channelSeries.videoCount))
      : Promise.resolve([]),
  ]);

  const sopOrder: Record<string, number> = {
    human: 0,
    hottest: 1,
    single_video: 2,
    ai_reference: 3,
  };
  const sortedSops = [...sops].sort(
    (a, b) => (sopOrder[a.sopType] ?? 99) - (sopOrder[b.sopType] ?? 99),
  );
  const primarySops = sortedSops.filter(
    (s) => s.sopType !== "ai_reference" && s.sopType !== "single_video",
  );
  const singleVideoSops = sortedSops.filter((s) => s.sopType === "single_video");
  const aiReferenceSops = sortedSops.filter((s) => s.sopType === "ai_reference");
  // Legacy hottest rows predate videoId; they dissected the top-viewed video, which is
  // videos[0] here (views DESC — same pick the worker made).
  const videoTitleById = new Map(videos.map((v) => [v.id, v.title]));
  const sourceTitleOf = (sop: (typeof sops)[number]) =>
    (sop.videoId ? videoTitleById.get(sop.videoId) : undefined) ??
    (sop.sopType === "hottest" ? videos[0]?.title : undefined);

  return (
    <div className="flex w-full min-w-0 flex-1 flex-col gap-6 p-6 sm:p-8">
      <BackLink href="/clerk" label="操盘小鹅" />

      <header className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="size-2 shrink-0 rounded-full bg-clerk" />
          <h1 className="truncate text-2xl font-semibold tracking-tight">
            {cleanProfileName(channel.name)} 的账号画像
          </h1>
          <Badge variant="secondary" className="shrink-0 font-mono text-[10px]">
            {videos.length} {itemUnit}
          </Badge>
          {primarySops.length > 0 ? (
            <Badge variant="secondary" className="shrink-0 font-mono text-[10px]">
              {primarySops.length} 份 SOP
            </Badge>
          ) : null}
        </div>
      </header>

      {videos.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1">
          <Button variant="ghost" size="sm" render={<a href="#videos" />}>
            已分析{itemNoun} {videos.length}
          </Button>
          {channel.platform === "youtube" ? (
            <Button variant="ghost" size="sm" render={<a href="#series" />}>
              系列归类
            </Button>
          ) : null}
          {primarySops.length > 0 ? (
            <Button variant="ghost" size="sm" render={<a href="#sop" />}>
              脚本 SOP {primarySops.length}
            </Button>
          ) : null}
        </div>
      ) : null}

      <ClerkRunButton
        target={{ kind: "own", channelId: channel.id }}
        channelName={channel.name}
        channelSlug={channel.slug}
        platform={channel.platform}
        initialActive={activeRun}
        lockedByOtherRun={!activeRun && !!clerkLock}
      />

      {videos.length > 0 ? (
        <div className="flex justify-end">
          <ResetTargetButton target={{ kind: "own", channelId: channel.id }} name={channel.name} />
        </div>
      ) : null}

      <div id="videos" className="scroll-mt-20 overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>标题</TableHead>
            <TableHead className="w-20">类型</TableHead>
            <TableHead className="w-24">{isXhs ? "文本来源" : "字幕来源"}</TableHead>
            <TableHead className="hidden w-28 md:table-cell">开场钩子</TableHead>
            <TableHead className="w-20">{PLATFORM_METRIC_LABEL[channel.platform]}</TableHead>
            <TableHead className="w-20">时长</TableHead>
            <TableHead className="hidden w-28 md:table-cell">分析时间</TableHead>
            <TableHead className="w-28 text-right">单条拆解</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {videos.map((v) => (
            <TableRow key={v.id}>
              <TableCell className="max-w-md truncate font-medium">
                <div className="flex items-center gap-2">
                  {v.coverDiagnosis ? (
                    <span
                      title={`封面可改进点：${v.coverDiagnosis.slice(0, 200)}`}
                      className="size-2 shrink-0 rounded-full bg-amber-500"
                      aria-label="cover has diagnosis"
                    />
                  ) : null}
                  <Link
                    href={`/clerk/${encodeURIComponent(slug)}/${encodeURIComponent(v.platformVideoId)}`}
                    className="truncate hover:text-foreground hover:underline"
                  >
                    {v.title}
                  </Link>
                </div>
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

      {channel.platform === "youtube" ? (
        <div id="series" className="scroll-mt-20">
          <ClerkSeriesPanel channelId={channel.id} initialSeries={seriesRows} />
        </div>
      ) : null}

      {primarySops.length > 0 ? (
        <section id="sop" className="flex scroll-mt-20 flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-medium text-muted-foreground">脚本撰写 SOP</h2>
            <p className="text-xs text-muted-foreground">
              SOP 是这个账号全部拆解的实时汇总（基于 {videos.length} 条{itemNoun}），每次分析后自动刷新到最新。
            </p>
          </div>
          <div className="flex flex-col gap-4">
            {primarySops.map((sop) => (
              <SopCard key={sop.id} sop={sop} showDelete sourceVideoTitle={sourceTitleOf(sop)} />
            ))}
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
              <SopCard key={sop.id} sop={sop} showDelete sourceVideoTitle={sourceTitleOf(sop)} />
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
              <SopCard key={sop.id} sop={sop} showDelete />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

