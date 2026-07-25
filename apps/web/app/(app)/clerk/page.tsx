import { and, count, desc, eq, inArray, isNull, max } from "drizzle-orm";
import Link from "next/link";

import { clerkSops, clerkVideos, competitorAccounts } from "@goooose/db";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CompetitorAvatar } from "@/components/competitor-avatar";
import { ClerkTabs } from "./_components/clerk-tabs";
import { followerNoun, formatFollowerCount } from "@/lib/format-count";
import { PLATFORM_LABEL } from "@/lib/platform";
import { formatDate } from "@/lib/datetime";
import { db } from "@/lib/db";
import { SOP_LABEL, SOP_ORDER } from "@/lib/sop-labels";
import { ensureCurrentUser } from "@/lib/users";

export default async function ClerkLandingPage() {
  const user = await ensureCurrentUser();
  if (!user) return null;

  // Own accounts deliberately absent: they 复盘 via the account page's opt-in entry.
  const competitors = await db
    .select({
      id: competitorAccounts.id,
      name: competitorAccounts.name,
      url: competitorAccounts.url,
      platform: competitorAccounts.platform,
      avatarUrl: competitorAccounts.avatarUrl,
      subscriberCount: competitorAccounts.subscriberCount,
      videoCount: count(clerkVideos.id),
      lastAnalyzedAt: max(clerkVideos.analyzedAt),
    })
    .from(competitorAccounts)
    .leftJoin(clerkVideos, eq(clerkVideos.competitorAccountId, competitorAccounts.id))
    .where(and(eq(competitorAccounts.userId, user.id), isNull(competitorAccounts.deletedAt)))
    .groupBy(competitorAccounts.id)
    .orderBy(desc(max(clerkVideos.analyzedAt)), desc(competitorAccounts.createdAt));

  const sopRows = competitors.length
    ? await db
        .select({ competitorAccountId: clerkSops.competitorAccountId, sopType: clerkSops.sopType })
        .from(clerkSops)
        .where(inArray(clerkSops.competitorAccountId, competitors.map((c) => c.id)))
    : [];
  const sopTypes = new Map<string, Set<string>>();
  for (const r of sopRows) {
    if (!r.competitorAccountId) continue;
    const set = sopTypes.get(r.competitorAccountId) ?? new Set<string>();
    set.add(r.sopType);
    sopTypes.set(r.competitorAccountId, set);
  }

  return (
    <div className="flex w-full min-w-0 flex-1 flex-col gap-6 p-6 sm:p-8">
      <header className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="size-2 shrink-0 rounded-full bg-clerk" />
          <h1 className="text-2xl font-semibold tracking-tight">操盘小鹅</h1>
        </div>
        <p className="text-xs text-muted-foreground">
          拆解对标账号的视频结构、钩子、节奏，沉淀可复用的写稿 SOP — 产出进库，任何项目都能选用。
        </p>
      </header>

      <ClerkTabs />

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">对标账号</h2>
          <Button variant="outline" size="sm" render={<Link href="/competitors" />}>
            管理对标 / 添加账号
          </Button>
        </div>
        {competitors.length === 0 ? (
          <div className="flex items-center justify-between rounded-lg border border-dashed bg-card/40 p-5 text-sm text-muted-foreground">
            <span>还没有对标账号 — 先添加要分析的账号，再拆解</span>
            <Link href="/competitors" className="text-xs hover:text-foreground hover:underline">
              添加账号 →
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {competitors.map((c) => {
              const types = [...(sopTypes.get(c.id) ?? [])].sort(
                (a, b) => (SOP_ORDER[a] ?? 99) - (SOP_ORDER[b] ?? 99),
              );
              return (
                <Link
                  key={c.id}
                  href={`/clerk/competitor/${c.id}`}
                  className="flex items-center gap-4 rounded-lg border bg-card p-4 transition-colors hover:bg-muted/50"
                >
                  <CompetitorAvatar name={c.name} avatarUrl={c.avatarUrl} className="size-10" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium">{c.name ?? c.url}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {PLATFORM_LABEL[c.platform]}
                        {c.subscriberCount != null
                          ? ` · ${formatFollowerCount(c.subscriberCount)} ${followerNoun(c.platform)}`
                          : ""}
                      </span>
                    </div>
                    <span className="truncate font-mono text-[11px] text-muted-foreground/80">
                      {c.url}
                    </span>
                    {c.videoCount > 0 ? (
                      <>
                        <span className="font-mono text-[11px] text-muted-foreground">
                          已拆 {c.videoCount} 条
                          {c.lastAnalyzedAt ? ` · 最近分析 ${formatDate(c.lastAnalyzedAt)}` : ""}
                        </span>
                        {types.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {types.map((t) => (
                              <Badge key={t} variant="secondary" className="text-[10px]">
                                {SOP_LABEL[t] ?? t}
                              </Badge>
                            ))}
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">未拆解 — 点进去开始分析</span>
                    )}
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">进入 →</span>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
