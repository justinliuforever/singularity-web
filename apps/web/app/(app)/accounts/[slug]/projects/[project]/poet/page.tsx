import { and, asc, desc, eq, isNull } from "drizzle-orm";
import Link from "next/link";

import {
  museIdeas,
  museMonitorVideos,
  poetBible,
  poetCustomTopics,
  poetScripts,
  type CustomTopicReference,
} from "@goooose/db";

import { formatDurationLabel } from "@goooose/domain/schemas/poet";
import { Badge } from "@/components/ui/badge";
import { BackLink } from "@/components/back-link";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/markdown";
import { PoetFactList } from "@/components/poet-fact-list";
import { getActiveAgentRun } from "@/lib/agent-run";
import { formatDateTime } from "@/lib/datetime";
import { db } from "@/lib/db";
import { resolveOwnedProject } from "@/lib/account-access";

import { DeleteScriptButton } from "./_components/delete-script-button";
import { RenameScriptButton } from "./_components/rename-script-button";
import { CustomTopicActions } from "./_components/custom-topic-actions";
import { CustomTopicCreateSheet } from "./_components/custom-topic-create-sheet";

import { PoetRunProgress } from "./_components/poet-run-progress";
import { WriteScriptButton } from "./_components/write-script-button";

type Props = { params: Promise<{ slug: string; project: string }> };

export default async function PoetChannelPage({ params }: Props) {
  const { slug: rawSlug, project: rawProject } = await params;
  const slug = decodeURIComponent(rawSlug);
  const projectSlug = decodeURIComponent(rawProject);

  const { user, channel, project } = await resolveOwnedProject(slug, projectSlug);

  const [activeBibleRow, approvedIdeas, customTopics, scripts, activeRun, accountPoetLock] =
    await Promise.all([
      db
        .select()
        .from(poetBible)
        .where(and(eq(poetBible.channelId, channel.id), eq(poetBible.isActive, true)))
        .limit(1),
      db
        .select({
          id: museIdeas.id,
          ideaNumber: museIdeas.ideaNumber,
          storyAngle: museIdeas.storyAngle,
          factsAndData: museIdeas.factsAndData,
          whySimilar: museIdeas.whySimilar,
          viralTrigger: museIdeas.viralTrigger,
          approved: museIdeas.approved,
          scripted: museIdeas.scripted,
          sourceTitle: museMonitorVideos.title,
        })
        .from(museIdeas)
        .leftJoin(museMonitorVideos, eq(museMonitorVideos.id, museIdeas.sourceVideoId))
        .where(
          and(
            eq(museIdeas.projectId, project.id),
            eq(museIdeas.approved, true),
            eq(museIdeas.scripted, false),
            isNull(museIdeas.dismissedAt),
          ),
        )
        .orderBy(asc(museIdeas.generatedAt)),
      db
        .select()
        .from(poetCustomTopics)
        .where(eq(poetCustomTopics.projectId, project.id))
        .orderBy(desc(poetCustomTopics.updatedAt)),
      db
        .select({
          script: poetScripts,
          ideaTitle: museIdeas.storyAngle,
          topicTitle: poetCustomTopics.topic,
        })
        .from(poetScripts)
        .leftJoin(museIdeas, eq(museIdeas.id, poetScripts.ideaId))
        .leftJoin(poetCustomTopics, eq(poetCustomTopics.id, poetScripts.customTopicId))
        .where(eq(poetScripts.projectId, project.id))
        .orderBy(desc(poetScripts.generatedAt))
        .limit(100),
      getActiveAgentRun(channel.id, user.id, "poet", undefined, project.id),
      // The server lock is account-wide, so a sibling project's run still blocks starting here.
      getActiveAgentRun(channel.id, user.id, "poet"),
    ]);

  const activeBible = activeBibleRow[0] ?? null;

  // Key on the FK; SET NULL orphans collapse into one 来源已删除 group.
  type ScriptRow = (typeof scripts)[number];
  const scriptGroups: Array<{
    key: string;
    title: string;
    topicId: string | null;
    rows: ScriptRow[];
  }> = [];
  {
    const groupIndex = new Map<string, number>();
    for (const r of scripts) {
      const key = r.script.ideaId ?? r.script.customTopicId ?? "orphan";
      let idx = groupIndex.get(key);
      if (idx === undefined) {
        idx = scriptGroups.length;
        groupIndex.set(key, idx);
        scriptGroups.push({
          key,
          title: r.ideaTitle ?? r.topicTitle ?? "来源已删除",
          topicId: r.script.customTopicId,
          rows: [],
        });
      }
      scriptGroups[idx]!.rows.push(r);
    }
  }

  return (
    <div className="flex w-full min-w-0 flex-1 flex-col gap-8 p-6 sm:p-8">
      <BackLink href={`/accounts/${encodeURIComponent(slug)}/projects/${encodeURIComponent(projectSlug)}`} label="项目" />

      <header className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="size-2 rounded-full bg-poet" />
          <h1 className="text-2xl font-semibold tracking-tight">{channel.name}</h1>
          <Badge variant="secondary" className="font-mono text-[10px]">
            {scripts.length} 篇脚本
          </Badge>
          <Badge variant="secondary" className="font-mono text-[10px]">
            {approvedIdeas.length} 个待写
          </Badge>
        </div>
      </header>

      <PoetRunProgress
        accountSlug={slug}
        projectSlug={projectSlug}
        initialActive={
          activeRun
            ? {
                runId: activeRun.runId,
                triggerRunId: activeRun.triggerRunId,
                publicAccessToken: activeRun.publicAccessToken,
                startedAt: activeRun.startedAt,
                kind:
                  ["poet-generate-bible", "poet-import-bible"].includes(activeRun.command)
                    ? "bible"
                    : activeRun.command === "poet-analyze-custom-topic"
                      ? "analyze"
                      : "script",
              }
            : null
        }
      />


      {approvedIdeas.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">灵感小鹅选题 · 待写</h2>
          <div className="flex flex-col gap-3">
            {approvedIdeas.map((idea) => (
              <article
                key={idea.id}
                className="flex items-start justify-between gap-3 rounded-lg border bg-card p-4"
              >
                <div className="flex flex-1 flex-col gap-1">
                  <span className="font-mono text-xs text-muted-foreground">
                    #{idea.ideaNumber}
                    {idea.sourceTitle ? ` · 来源：${idea.sourceTitle}` : ""}
                  </span>
                  <h3 className="text-sm font-medium whitespace-pre-wrap">
                    {idea.storyAngle ?? "—"}
                  </h3>
                  {idea.whySimilar ? (
                    <p className="text-xs text-muted-foreground line-clamp-2">{idea.whySimilar}</p>
                  ) : null}
                </div>
                <WriteScriptButton
                  channelId={channel.id}
                  projectId={project.id}
                  channelSlug={channel.slug}
                  ideaId={idea.id}
                  ideaTitle={idea.storyAngle ?? "选题"}
                  disabled={!activeBible || !!accountPoetLock}
                  disabledReason={
                    !activeBible
                      ? "请先在账号页生成并选用频道圣经"
                      : accountPoetLock
                        ? "该账号有神笔小鹅任务在运行，完成后再启动"
                        : undefined
                  }
                />
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">
            自定义选题（跳过灵感小鹅，直接喂主题）
          </h2>
          <CustomTopicCreateSheet
            channelId={channel.id}
            projectId={project.id}
            hasActiveBible={!!activeBible}
          />
        </div>
        {customTopics.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed bg-card/40 p-6 text-center text-xs text-muted-foreground">
            <span>
              {activeBible
                ? "想到什么写什么 — 新建一个自定义选题，AI 会根据账号圣经分析并写稿"
                : "新建自定义选题；写稿前请先在账号页生成频道圣经"}
            </span>
            {!activeBible ? (
              <Button
                variant="outline"
                size="sm"
                render={<Link href={`/accounts/${encodeURIComponent(slug)}/bible`} />}
              >
                去账号页生成圣经
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {customTopics.map((t) => (
              <article
                key={t.id}
                className="flex flex-col gap-3 rounded-lg border bg-card p-4"
              >
                <header className="flex items-start justify-between gap-3">
                  <div className="flex flex-1 flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={t.status === "scripted" ? "secondary" : "outline"}
                        className="text-[10px]"
                      >
                        {t.status === "draft"
                          ? "草稿"
                          : t.status === "analyzed"
                            ? "已分析"
                            : "已写稿"}
                      </Badge>
                      <span className="font-mono text-[10px] text-muted-foreground uppercase">
                        {t.language}
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {formatDateTime(t.updatedAt)}
                      </span>
                    </div>
                    <h3 className="text-sm font-medium whitespace-pre-wrap">{t.topic}</h3>
                  </div>
                  <CustomTopicActions
                    channelId={channel.id}
                    projectId={project.id}
                    channelSlug={channel.slug}
                    topicId={t.id}
                    topicLabel={t.topic}
                    status={t.status}
                    hasActiveBible={!!activeBible}
                    lockedReason={accountPoetLock ? "该账号有神笔小鹅任务在运行，完成后再启动" : undefined}
                  />
                </header>

                {((t.references as CustomTopicReference[] | null) ?? []).length > 0 ? (
                  <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
                    {((t.references as CustomTopicReference[] | null) ?? []).map((r, i) => (
                      <li key={i} className="truncate">
                        <span className="font-mono uppercase">[{r.kind}]</span>{" "}
                        {r.title ?? r.url ?? "未命名素材"}
                      </li>
                    ))}
                  </ul>
                ) : null}

                {t.status !== "draft" && t.storyAngle ? (
                  <details className="flex flex-col gap-2">
                    <summary className="cursor-pointer text-xs font-medium text-muted-foreground list-none [&::-webkit-details-marker]:hidden">
                      展开分析结果
                    </summary>
                    <div className="grid gap-3 border-t pt-3 text-xs">
                      {t.storyAngle ? (
                        <div className="flex flex-col gap-1">
                          <span className="font-medium uppercase text-muted-foreground">
                            故事角度
                          </span>
                          <p className="whitespace-pre-wrap">{t.storyAngle}</p>
                        </div>
                      ) : null}
                      {t.factsAndData ? (
                        <div className="flex flex-col gap-1">
                          <span className="font-medium uppercase text-muted-foreground">
                            事实与数据
                          </span>
                          <Markdown text={t.factsAndData} />
                        </div>
                      ) : null}
                      {t.factChecks.length > 0 ? (
                        <div className="flex flex-col gap-1">
                          <span className="font-medium uppercase text-muted-foreground">
                            原文事实
                          </span>
                          <PoetFactList facts={t.factChecks} references={t.references} />
                        </div>
                      ) : t.verbatimFacts ? (
                        <div className="flex flex-col gap-1">
                          <span className="font-medium uppercase text-muted-foreground">
                            原文事实
                          </span>
                          <p className="whitespace-pre-wrap font-mono">{t.verbatimFacts}</p>
                        </div>
                      ) : null}
                      {t.whySimilar ? (
                        <div className="flex flex-col gap-1">
                          <span className="font-medium uppercase text-muted-foreground">
                            为什么对标
                          </span>
                          <p className="whitespace-pre-wrap">{t.whySimilar}</p>
                        </div>
                      ) : null}
                      {t.viralTrigger ? (
                        <div className="flex flex-col gap-1">
                          <span className="font-medium uppercase text-muted-foreground">
                            爆款触发因素
                          </span>
                          <p className="whitespace-pre-wrap">{t.viralTrigger}</p>
                        </div>
                      ) : null}
                    </div>
                  </details>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>

      {scripts.length > 0 ? (
        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-medium text-muted-foreground">已生成脚本 · 按选题归组</h2>
            {scripts.length >= 100 ? (
              <span className="text-xs text-muted-foreground">仅显示最近 100 篇</span>
            ) : null}
          </div>
          <div className="flex flex-col gap-5">
            {scriptGroups.map((g) => (
              <div key={g.key} className="flex flex-col gap-2">
                <div className="flex items-baseline gap-2 min-w-0">
                  {g.topicId ? (
                    <Link
                      href={`/accounts/${encodeURIComponent(slug)}/projects/${encodeURIComponent(projectSlug)}/poet/topics/${g.topicId}`}
                      className="line-clamp-1 text-sm font-medium hover:underline"
                    >
                      {g.title}
                    </Link>
                  ) : (
                    <span className="line-clamp-1 text-sm font-medium">{g.title}</span>
                  )}
                  <Badge variant="secondary" className="shrink-0 font-mono text-[10px]">
                    {g.rows.length} 稿
                  </Badge>
                </div>
                <div className="ml-1.5 flex flex-col gap-2 border-l pl-4">
                  {g.rows.map(({ script: s }) => (
                    <article
                      key={s.id}
                      className="flex items-start justify-between gap-3 rounded-lg border bg-card p-4 hover:bg-muted/30"
                    >
                      <Link
                        href={`/accounts/${encodeURIComponent(slug)}/projects/${encodeURIComponent(projectSlug)}/poet/scripts/${s.id}`}
                        className="flex flex-1 flex-col gap-2 min-w-0"
                      >
                        <div className="flex items-center gap-3">
                          <span className="line-clamp-1 text-sm font-medium">
                            {s.name ?? `脚本 · ${formatDateTime(s.generatedAt)}`}
                          </span>
                          <Badge variant="secondary" className="shrink-0 font-mono text-[10px] uppercase">
                            {s.language}
                          </Badge>
                          <span className="shrink-0 font-mono text-xs text-muted-foreground">
                            {s.wordCount ?? "—"} {s.language === "zh" ? "字" : "词"}
                          </span>
                          {formatDurationLabel(s.durationSeconds) ? (
                            <span className="shrink-0 font-mono text-xs text-muted-foreground">
                              {formatDurationLabel(s.durationSeconds)}
                            </span>
                          ) : null}
                          <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
                            {formatDateTime(s.generatedAt)}
                          </span>
                        </div>
                        <p className="line-clamp-2 text-xs text-muted-foreground whitespace-pre-wrap">
                          {s.scriptText.slice(0, 240)}
                        </p>
                      </Link>
                      <div className="flex items-center">
                        <RenameScriptButton scriptId={s.id} currentName={s.name ?? ""} />
                        <DeleteScriptButton scriptId={s.id} />
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {!activeBible && approvedIdeas.length === 0 && scripts.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 py-8 text-sm text-muted-foreground">
          <span>这个项目还没有脚本</span>
          <span className="text-xs">
            先在账号页生成圣经 → 用灵感小鹅出选题 → 回到这里点「写稿」
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              render={<Link href={`/accounts/${encodeURIComponent(slug)}/bible`} />}
            >
              去账号页生成圣经
            </Button>
            <Button
              size="sm"
              variant="ghost"
              render={
                <Link
                  href={`/accounts/${encodeURIComponent(slug)}/projects/${encodeURIComponent(projectSlug)}/muse`}
                />
              }
            >
              去灵感小鹅出选题
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
