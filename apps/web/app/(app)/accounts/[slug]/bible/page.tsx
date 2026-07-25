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

      <details className="flex flex-col gap-3 rounded-lg border bg-card/50 p-4 text-sm">
        <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">
          圣经是怎么生成和使用的？
        </summary>
        <div className="mt-3 flex flex-col gap-2 text-xs leading-relaxed text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">两种生成方式：</span>
            「描述想法」只顺着你写的内容展开，你没提到的章节会留「（暂无，可后续补充）」——AI 不会替你编，所以描述越具体，圣经越完整。
            「导入文件」把文档重构成一份不超过 7000 字的策略简报：数字、人名、专有名词逐字保留并与原文核对，但不是全文照搬——
            表格明细和次要段落会按重要性取舍，「信息源」「选题框架」两节在文档没写到时由 AI 按你的领域补写。完整原文会另存一份。
          </p>
          <p>
            <span className="font-medium text-foreground">各功能按需读取章节（括号内是圣经正文里的标记）：</span>
            短稿（不足 10 分钟，中文约 2000 字以内）读 定位 POSITIONING、人设 PERSONA、内容规则 CONTENT_RULES、方法论 METHODOLOGY；
            长稿（10 分钟及以上）走「大纲 → 分段扩写」，这两步只跟 SOP 和素材，不读圣经章节；
            选题分析读 定位、受众 AUDIENCE、内容支柱 CONTENT_PILLARS、内容规则、选题框架 TOPIC_FRAMEWORK、信息源 INFORMATION_SOURCES；
            巡视对标读 定位、受众、内容规则。
            旧格式圣经（正文里没有这些英文标记的）不支持按需读取，会整本传入——重新生成一版即可。
          </p>
          <p>
            <span className="font-medium text-foreground">事实类内容（数字、案例、产品信息）：</span>
            只有「导入文件」生成的圣经，其 方法论 METHODOLOGY 与 事实表 FACT_SHEET 才会在选题分析中作为可信事实被引用，
            依据是它们逐字来自你的文档。数字会与转写自动比对，对不上的行会被移除并列为存疑项；扫描件与内嵌图表只能尽力核对，
            没覆盖到的会一并标出。你确认过或用「编辑」改过的内容不再复核，这部分请自行把关。
            这样设计是为了防止 AI 把资料里的事实错误地放进不相关的稿子。
          </p>
        </div>
      </details>

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
