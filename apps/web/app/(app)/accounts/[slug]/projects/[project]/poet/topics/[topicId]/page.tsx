import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";

import { poetBible, poetCustomTopics, clerkSops } from "@goooose/db";
import type { CustomTopicReference } from "@goooose/db";

import { Badge } from "@/components/ui/badge";
import { BackLink } from "@/components/back-link";
import { Markdown } from "@/components/markdown";
import { PoetFactList } from "@/components/poet-fact-list";
import { formatDateTime } from "@/lib/datetime";
import { db } from "@/lib/db";
import { xhsGoHref } from "@/lib/xhs-go";
import { sopTypeLabel } from "@/lib/sop-labels";
import { resolveOwnedProject } from "@/lib/account-access";

import { CustomTopicActions } from "../../_components/custom-topic-actions";

type Props = { params: Promise<{ slug: string; project: string; topicId: string }> };

function Section({ title, body, markdown }: { title: string; body: string | null; markdown?: boolean }) {
  if (!body) return null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      {markdown ? <Markdown text={body} /> : <p className="text-sm whitespace-pre-wrap">{body}</p>}
    </section>
  );
}

function ReferenceChip({ reference }: { reference: CustomTopicReference }) {
  const label =
    reference.title ?? reference.url ?? reference.text?.slice(0, 60) ?? reference.kind;
  if (reference.url) {
    return (
      <a
        href={xhsGoHref(reference.url)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 rounded-md border bg-muted/50 px-2 py-1 text-xs hover:bg-muted"
      >
        <Badge variant="secondary" className="text-[9px]">
          {reference.kind}
        </Badge>
        <span className="max-w-[24ch] truncate">{label}</span>
        <ExternalLink className="size-3" />
      </a>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md border bg-muted/50 px-2 py-1 text-xs">
      <Badge variant="secondary" className="text-[9px]">
        {reference.kind}
      </Badge>
      <span className="max-w-[24ch] truncate">{label}</span>
    </span>
  );
}

export default async function PoetTopicDetailPage({ params }: Props) {
  const { slug: rawSlug, project: rawProject, topicId } = await params;
  const slug = decodeURIComponent(rawSlug);
  const projectSlug = decodeURIComponent(rawProject);

  const { channel, project } = await resolveOwnedProject(slug, projectSlug);

  const [topic] = await db
    .select()
    .from(poetCustomTopics)
    .where(
      and(eq(poetCustomTopics.id, topicId), eq(poetCustomTopics.projectId, project.id)),
    )
    .limit(1);

  if (!topic) notFound();

  const [bible, sop, activeBibleRows] = await Promise.all([
    topic.bibleId
      ? db.select().from(poetBible).where(eq(poetBible.id, topic.bibleId)).limit(1).then((r) => r[0])
      : Promise.resolve(undefined),
    topic.sopId
      ? db.select().from(clerkSops).where(eq(clerkSops.id, topic.sopId)).limit(1).then((r) => r[0])
      : Promise.resolve(undefined),
    // Gating needs the current active bible, not the one the topic was analyzed against.
    db
      .select({ id: poetBible.id })
      .from(poetBible)
      .where(and(eq(poetBible.channelId, channel.id), eq(poetBible.isActive, true)))
      .limit(1),
  ]);

  return (
    <div className="flex w-full min-w-0 flex-1 flex-col gap-8 p-6 sm:p-8">
      <BackLink href={`/accounts/${encodeURIComponent(slug)}/projects/${encodeURIComponent(projectSlug)}/poet`} label="神笔小鹅" />

      <header className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight whitespace-pre-wrap">
            {topic.topic}
          </h1>
          <CustomTopicActions
            channelId={channel.id}
            projectId={project.id}
            channelSlug={channel.slug}
            topicId={topic.id}
            topicLabel={topic.topic}
            status={topic.status}
            hasActiveBible={activeBibleRows.length > 0}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <Badge variant="secondary" className="font-mono text-[10px]">
            {topic.status === "draft" ? "草稿" : topic.status === "analyzed" ? "已分析" : "已写稿"}
          </Badge>
          <span className="font-mono text-xs uppercase">{topic.language}</span>
          <span className="font-mono text-xs">更新于 {formatDateTime(topic.updatedAt)}</span>
        </div>
      </header>

      {topic.references.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            参考素材
          </h3>
          <div className="flex flex-wrap gap-2">
            {topic.references.map((reference, i) => (
              <ReferenceChip key={i} reference={reference} />
            ))}
          </div>
        </section>
      ) : null}

      <Section title="故事角度" body={topic.storyAngle} />
      <Section title="事实与数据" body={topic.factsAndData} markdown />
      {topic.factChecks.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            原文事实
          </h3>
          <PoetFactList facts={topic.factChecks} references={topic.references} />
        </section>
      ) : (
        <Section title="原文事实" body={topic.verbatimFacts} />
      )}
      <Section title="为什么对标" body={topic.whySimilar} />
      <Section title="爆款触发因素" body={topic.viralTrigger} />

      {bible || sop ? (
        <section className="flex flex-col gap-2 border-t pt-6">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            关联
          </h3>
          <div className="flex flex-col gap-1 text-sm">
            {bible ? (
              <span>
                圣经：{" "}
                <Link
                  href={`/accounts/${encodeURIComponent(slug)}/projects/${encodeURIComponent(projectSlug)}/poet`}
                  className="hover:text-foreground hover:underline"
                >
                  {bible.name}
                </Link>
              </span>
            ) : null}
            {sop ? (
              <span className="font-mono text-xs text-muted-foreground">
                SOP：{sopTypeLabel(sop.sopType)}（{sop.language}）
              </span>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
