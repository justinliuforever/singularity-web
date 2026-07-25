import { desc, eq } from "drizzle-orm";

import { poetBible } from "@goooose/db";

import { Badge } from "@/components/ui/badge";
import { BackLink } from "@/components/back-link";
import { Markdown } from "@/components/markdown";
import { getActiveAgentRun } from "@/lib/agent-run";
import { formatDateTime } from "@/lib/datetime";
import { db } from "@/lib/db";
import { resolveOwnedChannel } from "@/lib/account-access";

import { BibleGenerateSheet } from "../projects/[project]/poet/_components/bible-generate-sheet";
import { BibleHistory } from "../projects/[project]/poet/_components/bible-history";
import { BibleRunProgress } from "./_components/bible-run-progress";
import { ImportReviewCard } from "./_components/import-review-card";

type Props = { params: Promise<{ slug: string }> };

export default async function AccountBiblePage({ params }: Props) {
  const { slug: rawSlug } = await params;
  const slug = decodeURIComponent(rawSlug);

  const { user, channel } = await resolveOwnedChannel(slug);

  // Bible rows stay channel_id-authoritative during expand (project.id == channel.id).
  const [bibles, poetRun] = await Promise.all([
    db
      .select()
      .from(poetBible)
      .where(eq(poetBible.channelId, channel.id))
      .orderBy(desc(poetBible.updatedAt)),
    getActiveAgentRun(channel.id, user.id, "poet"),
  ]);

  const activeBibleRun =
    poetRun && ["poet-generate-bible", "poet-import-bible"].includes(poetRun.command) ? poetRun : null;

  const a = encodeURIComponent(channel.slug);
  const activeBible = bibles.find((b) => b.isActive) ?? null;

  return (
    <div className="flex w-full min-w-0 flex-1 flex-col gap-6 p-6 sm:p-8">
      <BackLink href={`/accounts/${a}`} label={channel.name} />

      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">频道圣经</h1>
          <p className="text-xs text-muted-foreground">
            账号的人设 / 受众 / 更新方向 · Muse 和 Poet 都会读取生效中的版本
          </p>
        </div>
        <BibleGenerateSheet
          channelId={channel.id}
          channelName={channel.name}
          channelDescription={channel.description}
          buttonLabel={activeBible ? "+ 新建版本" : "生成圣经"}
          buttonVariant="outline"
        />
      </header>

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

      {/* Stays mounted after the last flag is confirmed — it is what says the bible can now
          be activated, so dropping it on confirm would hide its own next step. */}
      {bibles
        .filter((b) => !b.isActive && (b.importFlags ?? []).length > 0)
        .map((b) => (
          <ImportReviewCard key={b.id} bibleId={b.id} bibleName={b.name} flags={b.importFlags ?? []} />
        ))}

      {activeBible ? (
        <article className="flex flex-col gap-3 rounded-lg border bg-card p-5">
          <header className="flex items-center justify-between">
            <h3 className="text-base font-medium">{activeBible.name}</h3>
            <Badge variant="secondary" className="text-[10px]">
              生效中
            </Badge>
          </header>
          <Markdown text={activeBible.content} className="max-h-96 overflow-y-auto" />
          <footer className="font-mono text-xs text-muted-foreground">
            {formatDateTime(activeBible.updatedAt)} 更新
          </footer>
        </article>
      ) : (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-card/40 p-8 text-sm text-muted-foreground">
          <span>这个账号还没有频道圣经</span>
          <span className="text-xs">账号的策略简报，Muse 和 Poet 都会以它为准</span>
          <BibleGenerateSheet
            channelId={channel.id}
            channelName={channel.name}
            channelDescription={channel.description}
            buttonLabel="生成圣经"
          />
        </div>
      )}

      <BibleHistory bibles={bibles} />
    </div>
  );
}
