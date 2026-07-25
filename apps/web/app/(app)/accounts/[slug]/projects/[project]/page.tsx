import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import Link from "next/link";
import { ArrowRight, ChevronDown } from "lucide-react";

import {
  channels,
  clerkSops,
  competitorAccounts,
  museIdeas,
  museMonitorVideos,
  poetBible,
  poetCustomTopics,
  poetScripts,
  projectSops,
} from "@goooose/db";
import { Badge } from "@/components/ui/badge";
import { BackLink } from "@/components/back-link";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import { PLATFORM_CONTENT_UNIT } from "@/lib/platform";
import { resolveOwnedProject } from "@/lib/account-access";

import { BibleChip } from "@/components/bible-chip";
import { ProjectCompetitorsCard } from "../../../_components/project-competitors-card";
import { DeleteProjectButton } from "./_components/delete-project-button";
import { EditProjectSheet } from "./_components/edit-project-sheet";
import { ProjectSopRow, type CurrentSop } from "./_components/project-sop-row";

type Props = { params: Promise<{ slug: string; project: string }> };

export default async function ProjectHubPage({ params }: Props) {
  const { slug: rawSlug, project: rawProject } = await params;
  const slug = decodeURIComponent(rawSlug);
  const projectSlug = decodeURIComponent(rawProject);

  const { channel, project } = await resolveOwnedProject(slug, projectSlug);

  const [
    [museVideoCount],
    [museIdeaCount],
    [poetTopicCount],
    [poetScriptCount],
    activeBibleRows,
  ] = await Promise.all([
    db.select({ c: count() }).from(museMonitorVideos).where(eq(museMonitorVideos.projectId, project.id)),
    db
      .select({ c: count() })
      .from(museIdeas)
      .where(and(eq(museIdeas.projectId, project.id), isNull(museIdeas.dismissedAt))),
    db.select({ c: count() }).from(poetCustomTopics).where(eq(poetCustomTopics.projectId, project.id)),
    db.select({ c: count() }).from(poetScripts).where(eq(poetScripts.projectId, project.id)),
    db
      .select()
      .from(poetBible)
      .where(and(eq(poetBible.channelId, channel.id), eq(poetBible.isActive, true)))
      .limit(1),
  ]);

  // Current writing SOP: explicit primary binding wins, else this account's latest ai_reference.
  const [pinnedSop] = await db
    .select({
      generatedAt: clerkSops.generatedAt,
      sourceName: sql<string>`coalesce(${channels.name}, ${competitorAccounts.name}, ${competitorAccounts.url}, '未知来源')`,
      sourceKind: sql<"own" | "competitor">`case when ${clerkSops.channelId} is not null then 'own' else 'competitor' end`,
    })
    .from(projectSops)
    .innerJoin(clerkSops, eq(clerkSops.id, projectSops.sopId))
    .leftJoin(channels, eq(channels.id, clerkSops.channelId))
    .leftJoin(competitorAccounts, eq(competitorAccounts.id, clerkSops.competitorAccountId))
    .where(and(eq(projectSops.projectId, project.id), eq(projectSops.role, "primary")))
    .limit(1);
  let currentSop: CurrentSop = pinnedSop
    ? {
        sourceName: pinnedSop.sourceName,
        generatedAt: pinnedSop.generatedAt,
        pinned: true,
        sourceKind: pinnedSop.sourceKind,
      }
    : null;
  if (!currentSop) {
    const [fallbackSop] = await db
      .select({ generatedAt: clerkSops.generatedAt })
      .from(clerkSops)
      .where(and(eq(clerkSops.channelId, channel.id), eq(clerkSops.sopType, "ai_reference")))
      .orderBy(desc(clerkSops.generatedAt))
      .limit(1);
    if (fallbackSop) {
      currentSop = {
        sourceName: channel.name,
        generatedAt: fallbackSop.generatedAt,
        pinned: false,
        sourceKind: "own",
      };
    }
  }

  const a = encodeURIComponent(channel.slug);
  const p = encodeURIComponent(project.slug);
  const activeBible = activeBibleRows[0] ?? null;
  const unit = PLATFORM_CONTENT_UNIT[project.platform];
  const itemDone = `${unit.measure}${unit.noun}已巡视`;

  return (
    <div className="flex w-full min-w-0 flex-1 flex-col gap-6 p-6 sm:p-8">
      <BackLink href={`/accounts/${a}`} label={channel.name} />

      <header className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
          <div className="flex items-center gap-1">
            <EditProjectSheet
              projectId={project.id}
              name={project.name}
              description={project.description}
            />
            {project.id !== project.ownAccountId ? (
              <DeleteProjectButton
                projectId={project.id}
                name={project.name}
                accountSlug={channel.slug}
              />
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Link href={`/accounts/${a}`} className="hover:text-foreground hover:underline">
            {channel.name}
          </Link>
          <span className="opacity-40">·</span>
          <Badge variant="secondary" className="font-mono text-[10px] uppercase">
            {project.platform}
          </Badge>
        </div>
      </header>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">账号上下文 · 全部项目共用</span>
        <BibleChip
          variant="band"
          name={activeBible?.name ?? null}
          manageHref={`/accounts/${a}/bible`}
        />
      </div>

      <section className="flex flex-col gap-2.5 border-l-2 border-l-muse/70 pl-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="flex items-center gap-2 text-base font-medium">
              <span className="size-2.5 rounded-full bg-muse" />
              灵感小鹅
            </span>
            <span className="text-xs text-muted-foreground">
              巡视对标账号 → 生成选题 · {museVideoCount?.c ?? 0} {itemDone} · {museIdeaCount?.c ?? 0} 选题
            </span>
          </div>
          <Button size="sm" render={<Link href={`/accounts/${a}/projects/${p}/muse`} />}>
            进入灵感小鹅
            <ArrowRight data-icon="inline-end" />
          </Button>
        </div>
        <div id="competitors" className="scroll-mt-20">
          <ProjectCompetitorsCard
            projectId={project.id}
            accountSlug={channel.slug}
            projectSlug={project.slug}
          />
        </div>
      </section>

      <div className="flex flex-col items-center gap-0.5 text-muted-foreground/70">
        <ChevronDown className="size-4" />
        <span className="text-[11px]">采用选题 → 神笔小鹅写稿</span>
      </div>

      <section className="flex flex-col gap-2.5 border-l-2 border-l-poet/70 pl-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="flex items-center gap-2 text-base font-medium">
              <span className="size-2.5 rounded-full bg-poet" />
              神笔小鹅
            </span>
            <span className="text-xs text-muted-foreground">
              选题 / 时长 / 参考 → 成稿 · {poetTopicCount?.c ?? 0} 自定义选题 · {poetScriptCount?.c ?? 0} 脚本
            </span>
          </div>
          <Button size="sm" render={<Link href={`/accounts/${a}/projects/${p}/poet`} />}>
            进入神笔小鹅
            <ArrowRight data-icon="inline-end" />
          </Button>
        </div>
        <ProjectSopRow projectId={project.id} current={currentSop} />
      </section>
    </div>
  );
}
