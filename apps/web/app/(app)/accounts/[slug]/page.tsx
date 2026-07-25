import { count, desc, eq } from "drizzle-orm";
import Link from "next/link";

import { clerkSops, clerkVideos, poetBible, projects } from "@goooose/db";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RefreshOwnAccountButton } from "@/components/refresh-own-account-button";
import { getActiveAgentRun } from "@/lib/agent-run";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/datetime";
import { followerNoun, formatFollowerCount } from "@/lib/format-count";
import { PLATFORM_CONTENT_UNIT } from "@/lib/platform";
import { stripMarkdown } from "@/lib/strip-markdown";
import { resolveOwnedChannel } from "@/lib/account-access";
import {
  isValidDouyinProfileUrl,
  isValidXhsProfileUrl,
  isValidYoutubeChannelUrl,
} from "@/server/trpc/schemas/channels";

import { DeleteChannelButton } from "../_components/delete-channel-button";
import { EditChannelSheet } from "../_components/edit-channel-sheet";
import { NewProjectSheet } from "./projects/_components/new-project-sheet";
import { BibleGenerateSheet } from "./projects/[project]/poet/_components/bible-generate-sheet";
import { BibleRunProgress } from "./bible/_components/bible-run-progress";

type Props = { params: Promise<{ slug: string }> };

export default async function AccountDetailPage({ params }: Props) {
  const { slug: rawSlug } = await params;
  const slug = decodeURIComponent(rawSlug);

  const { user, channel } = await resolveOwnedChannel(slug);

  const [[clerkVideoCount], [clerkSopCount], activeBibleRows, projectList, poetRun] = await Promise.all([
    db.select({ c: count() }).from(clerkVideos).where(eq(clerkVideos.channelId, channel.id)),
    db.select({ c: count() }).from(clerkSops).where(eq(clerkSops.channelId, channel.id)),
    db
      .select()
      .from(poetBible)
      .where(eq(poetBible.channelId, channel.id))
      .orderBy(desc(poetBible.updatedAt)),
    db
      .select()
      .from(projects)
      .where(eq(projects.ownAccountId, channel.id))
      .orderBy(desc(projects.createdAt)),
    getActiveAgentRun(channel.id, user.id, "poet"),
  ]);

  const a = encodeURIComponent(channel.slug);
  const unit = PLATFORM_CONTENT_UNIT[channel.platform];
  const itemNoun = `${unit.measure}${unit.noun}`;
  const activeBible = activeBibleRows.find((b) => b.isActive) ?? null;
  // Parked = a bible exists but none is live. Keying on open flags instead would drop the
  // page to the 先生成 empty state the moment the last flag is confirmed.
  const parked = activeBible ? [] : activeBibleRows;
  const parkedUnresolved = parked.filter((b) => (b.importFlags ?? []).some((f) => !f.resolved));
  const activeBibleRun =
    poetRun && ["poet-generate-bible", "poet-import-bible"].includes(poetRun.command)
      ? poetRun
      : null;
  const analyzed = (clerkVideoCount?.c ?? 0) > 0;
  const canRefresh =
    channel.platform === "xhs"
      ? isValidXhsProfileUrl(channel.platformUrl)
      : channel.platform === "douyin"
        ? isValidDouyinProfileUrl(channel.platformUrl)
        : isValidYoutubeChannelUrl(channel.platformUrl);

  return (
    <div className="flex w-full min-w-0 flex-1 flex-col gap-6 p-6 sm:p-8">
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{channel.name}</h1>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="secondary" className="font-mono text-[10px] uppercase">
              {channel.platform}
            </Badge>
            {channel.platformUrl ? (
              <a
                href={channel.platformUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate font-mono text-xs hover:text-foreground"
              >
                {channel.platformUrl}
              </a>
            ) : null}
          </div>
          {channel.subscriberCount != null || channel.lastVerifiedAt ? (
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {channel.subscriberCount != null ? (
                <span className="font-mono font-semibold text-foreground">
                  {formatFollowerCount(channel.subscriberCount)} {followerNoun(channel.platform)}
                </span>
              ) : null}
              {channel.lastVerifiedAt ? (
                <span>数据更新于 {formatDateTime(channel.lastVerifiedAt)}</span>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {canRefresh ? <RefreshOwnAccountButton channelId={channel.id} /> : null}
          <EditChannelSheet channel={channel} />
          <DeleteChannelButton id={channel.id} name={channel.name} redirectTo="/" />
        </div>
      </header>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">
            ① 频道圣经 · 账号的人设 / 受众 / 更新方向
          </h2>
          {/* Any bible row, not just an active one — a parked import would be unreachable. */}
          {activeBibleRows.length > 0 ? (
            <Button variant="ghost" size="sm" render={<Link href={`/accounts/${a}/bible`} />}>
              管理圣经
            </Button>
          ) : null}
        </div>
        <BibleRunProgress
          initialActive={
            activeBibleRun
              ? {
                  runId: activeBibleRun.runId,
                  triggerRunId: activeBibleRun.triggerRunId,
                  publicAccessToken: activeBibleRun.publicAccessToken,
                  startedAt: activeBibleRun.startedAt,
                }
              : null
          }
        />

        {/* A parked import is a finished run; without this card the page reads as "nothing happened". */}
        {parked.length > 0 ? (
          <Link href={`/accounts/${a}/bible`}>
            <Card className="border-amber-500/50 transition-colors hover:bg-muted/50">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  {parked[0]!.name}
                  <Badge variant="warning" className="text-[10px]">
                    {parkedUnresolved.length > 0 ? "待确认" : "待启用"}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  圣经已生成{parked.length > 1 ? `（共 ${parked.length} 份）` : ""}，
                  {parkedUnresolved.length > 0
                    ? "还有存疑项需要你逐项确认，确认后才会生效。点击去确认 →"
                    : "还没有启用。点击去启用 →"}
                </p>
              </CardContent>
            </Card>
          </Link>
        ) : null}

        {activeBible ? (
          <Link href={`/accounts/${a}/bible`}>
            <Card className="transition-colors hover:bg-muted/50">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  {activeBible.name}
                  <Badge variant="success" className="text-[10px]">
                    生效中
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                  {stripMarkdown(activeBible.content)}
                </p>
              </CardContent>
            </Card>
          </Link>
        ) : parked.length > 0 ? null : (
          <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed bg-card/40 p-6">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">先生成这个账号的频道圣经</span>
              <span className="max-w-xl text-xs text-muted-foreground">
                用一段话描述账号定位（人设、受众、更新方向），AI 会生成一份策略简报；之后 Muse
                出选题、Poet 写稿都按它来。
              </span>
            </div>
            <BibleGenerateSheet
              channelId={channel.id}
              channelName={channel.name}
              channelDescription={channel.description}
              buttonLabel="生成频道圣经"
            />
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">② 项目 · 不同更新形式的分类</h2>
          <NewProjectSheet accountSlug={channel.slug} />
        </div>
        {projectList.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-card/40 p-6 text-center text-xs text-muted-foreground">
            还没有项目 — 新建一个项目，就能在里面出选题、写稿
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {projectList.map((proj) => (
              <Link key={proj.id} href={`/accounts/${a}/projects/${encodeURIComponent(proj.slug)}`}>
                <Card className="transition-colors hover:bg-muted/50">
                  <CardHeader className="pb-2">
                    <CardTitle className="truncate text-sm font-medium">{proj.name}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
                      <Badge variant="secondary" className="font-mono text-[10px] uppercase">
                        {proj.platform}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      <Link
        href={`/clerk/${a}`}
        className="flex w-full items-center justify-between gap-3 rounded-lg border border-clerk/40 bg-clerk/5 p-3 transition-colors hover:bg-clerk/10"
      >
        <div className="flex items-center gap-2.5">
          <span className="size-2 shrink-0 rounded-full bg-clerk" />
          <div className="flex flex-col">
            <span className="text-sm font-medium">在 Clerk 复盘这个账号</span>
            <span className="text-xs text-muted-foreground">
              {analyzed
                ? `已拆 ${clerkVideoCount?.c ?? 0} ${itemNoun} · ${clerkSopCount?.c ?? 0} 份 SOP`
                : "可选，拆解自己发过的内容找规律"}
            </span>
          </div>
        </div>
        <span className="text-muted-foreground">→</span>
      </Link>
    </div>
  );
}
