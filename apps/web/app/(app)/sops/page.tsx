import { and, count, desc, eq, or } from "drizzle-orm";
import Link from "next/link";

import { channels, clerkSops, clerkVideos, competitorAccounts, projects, projectSops } from "@goooose/db";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ClerkTabs } from "../clerk/_components/clerk-tabs";
import { DeleteAccountSopsButton } from "../clerk/_components/delete-account-sops-button";
import { SopCard } from "../clerk/_components/sop-card";
import { db } from "@/lib/db";
import { ensureCurrentUser } from "@/lib/users";

type SopRow = {
  id: string;
  sopType: string;
  language: string;
  contentMd: string;
  generatedAt: Date | null;
  sourceKind: "own" | "competitor";
  sourceName: string;
  sourceHref: string;
  sourceVideoTitle: string | null;
  owner: { channelId: string } | { competitorAccountId: string };
};

const sopOrder: Record<string, number> = {
  human: 0,
  hottest: 1,
  single_video: 2,
  ai_reference: 3,
};

export default async function SopsLibraryPage() {
  const user = await ensureCurrentUser();
  if (!user) return null;

  const rows = await db
    .select({
      id: clerkSops.id,
      sopType: clerkSops.sopType,
      language: clerkSops.language,
      contentMd: clerkSops.contentMd,
      generatedAt: clerkSops.generatedAt,
      channelId: channels.id,
      channelName: channels.name,
      channelSlug: channels.slug,
      competitorId: competitorAccounts.id,
      competitorName: competitorAccounts.name,
      competitorUrl: competitorAccounts.url,
      sourceVideoTitle: clerkVideos.title,
    })
    .from(clerkSops)
    .leftJoin(channels, eq(clerkSops.channelId, channels.id))
    .leftJoin(competitorAccounts, eq(clerkSops.competitorAccountId, competitorAccounts.id))
    .leftJoin(clerkVideos, eq(clerkSops.videoId, clerkVideos.id))
    .where(or(eq(channels.userId, user.id), eq(competitorAccounts.userId, user.id)))
    .orderBy(desc(clerkSops.generatedAt));

  // Without the projects join these counts aggregate every user's bindings.
  const usage = await db
    .select({ sopId: projectSops.sopId, n: count() })
    .from(projectSops)
    .innerJoin(projects, eq(projects.id, projectSops.projectId))
    .where(and(eq(projectSops.role, "primary"), eq(projects.userId, user.id)))
    .groupBy(projectSops.sopId);
  const usedByMap = new Map(usage.map((u) => [u.sopId, u.n]));

  const sops: SopRow[] = rows.map((r) => ({
    id: r.id,
    sopType: r.sopType,
    language: r.language,
    contentMd: r.contentMd,
    generatedAt: r.generatedAt,
    sourceKind: r.channelSlug ? "own" : "competitor",
    sourceName: r.channelName ?? r.competitorName ?? r.competitorUrl ?? "未知来源",
    sourceHref: r.channelSlug
      ? `/clerk/${encodeURIComponent(r.channelSlug)}`
      : `/clerk/competitor/${r.competitorId}`,
    sourceVideoTitle: r.sourceVideoTitle,
    owner: r.channelSlug
      ? { channelId: r.channelId! }
      : { competitorAccountId: r.competitorId! },
  }));

  const buildGroups = (kind: "own" | "competitor") => {
    const groups = new Map<
      string,
      { name: string; href: string; owner: SopRow["owner"]; sops: SopRow[] }
    >();
    for (const s of sops) {
      if (s.sourceKind !== kind) continue;
      const existing = groups.get(s.sourceHref);
      if (existing) existing.sops.push(s);
      else groups.set(s.sourceHref, { name: s.sourceName, href: s.sourceHref, owner: s.owner, sops: [s] });
    }
    return [...groups.values()];
  };
  const competitorGroups = buildGroups("competitor");
  const ownGroups = buildGroups("own");

  return (
    <div className="flex w-full min-w-0 flex-1 flex-col gap-6 p-6 sm:p-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">SOP 库</h1>
        <p className="text-sm text-muted-foreground">
          SOP 是 Clerk 从频道拆解出的可复用写稿方法论 — 任何项目都可以在项目主页选用任意一份用于写稿。
        </p>
      </header>

      <ClerkTabs />

      {sops.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-card/40 p-10 text-sm text-muted-foreground">
          <span>还没有任何 SOP</span>
          <Button render={<Link href="/clerk" />}>去 Clerk 拆解</Button>
        </div>
      ) : (
        <>
          {competitorGroups.length > 0 ? (
            <SourceSection
              title="来自对标账号"
              groups={competitorGroups}
              chip="🎯 对标"
              usedByMap={usedByMap}
            />
          ) : null}
          {ownGroups.length > 0 ? (
            <SourceSection
              title="来自我的账号"
              groups={ownGroups}
              chip="📺 我的"
              usedByMap={usedByMap}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

function SourceSection({
  title,
  groups,
  chip,
  usedByMap,
}: {
  title: string;
  groups: Array<{ name: string; href: string; owner: SopRow["owner"]; sops: SopRow[] }>;
  chip: string;
  usedByMap: Map<string, number>;
}) {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      {groups.map((group) => {
        const sorted = [...group.sops].sort(
          (x, y) => (sopOrder[x.sopType] ?? 99) - (sopOrder[y.sopType] ?? 99),
        );
        const primarySops = sorted.filter((s) => s.sopType !== "ai_reference");
        const aiReferenceSops = sorted.filter((s) => s.sopType === "ai_reference");
        return (
          <details key={group.href} open className="flex flex-col gap-3 rounded-lg border bg-card/30 p-4">
            <summary className="flex cursor-pointer items-center gap-3">
              <span className="size-2 shrink-0 rounded-full bg-clerk" />
              <h3 className="truncate text-base font-medium">{group.name}</h3>
              <Badge variant="outline" className="shrink-0 text-[10px]">
                {chip}
              </Badge>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">
                {primarySops.length} 份
              </span>
            </summary>

            <div className="mt-2 flex flex-col gap-4">
              <div className="flex justify-end gap-1">
                <Button variant="ghost" size="sm" render={<Link href={group.href} />}>
                  查看分析
                </Button>
                <DeleteAccountSopsButton owner={group.owner} name={group.name} />
              </div>
              {/* Channel-set SOPs are generated together — 清空SOP is their delete. */}
              {primarySops.map((sop) => (
                <SopCard
                  key={sop.id}
                  sop={sop}
                  usedBy={usedByMap.get(sop.id) ?? 0}
                  showDelete={sop.sopType === "single_video"}
                  sourceVideoTitle={sop.sourceVideoTitle ?? undefined}
                />
              ))}

              {aiReferenceSops.length > 0 ? (
                <details className="flex flex-col gap-3 rounded-lg border bg-card/50 p-4 text-sm">
                  <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">
                    AI 底稿（默认隐藏 · 给 AI 用，非给人读 · 写稿选用的就是这类）
                  </summary>
                  <div className="mt-3 flex flex-col gap-4">
                    {aiReferenceSops.map((sop) => (
                      <SopCard key={sop.id} sop={sop} usedBy={usedByMap.get(sop.id) ?? 0} />
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
          </details>
        );
      })}
    </div>
  );
}

