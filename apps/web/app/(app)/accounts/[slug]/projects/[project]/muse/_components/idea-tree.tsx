"use client";

import { StaggerItem } from "@/components/stagger-item";
import { Badge } from "@/components/ui/badge";
import { inferPlatform, PLATFORM_LABEL } from "@/lib/platform";
import { xhsGoHref } from "@/lib/xhs-go";

import { IdeaActions } from "./idea-actions";

export type PendingIdea = {
  id: string;
  ideaNumber: number;
  storyAngle: string | null;
  factsAndData: string | null;
  whySimilar: string | null;
  viralTrigger: string | null;
  coverConcept: string | null;
  suggestedHookType: string | null;
  riskFactors: string | null;
};

export type PendingGroup = {
  key: string;
  sourceTitle: string | null;
  sourceUrl: string | null;
  sourceChannelName: string | null;
  isLatestRun: boolean;
  ideas: PendingIdea[];
};

type Props = {
  groups: PendingGroup[];
  accountSlug: string;
  projectSlug: string;
};

const DETAIL_FIELDS = [
  { key: "factsAndData", label: "事实与数据" },
  { key: "whySimilar", label: "为什么对标" },
  { key: "coverConcept", label: "封面建议" },
  { key: "suggestedHookType", label: "建议钩子类型" },
  { key: "riskFactors", label: "风险提示" },
  { key: "viralTrigger", label: "爆款触发因素" },
] as const;

function IdeaDetailFields({ idea }: { idea: PendingIdea }) {
  return (
    <div className="mt-3 flex flex-col gap-3">
      {DETAIL_FIELDS.map(({ key, label }) => {
        const value = idea[key];
        if (!value) return null;
        const warn = key === "riskFactors";
        return (
          <div key={key} className="flex flex-col gap-1">
            <h4
              className={`text-xs font-medium tracking-wide uppercase ${
                warn ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"
              }`}
            >
              {label}
            </h4>
            <p
              className={`text-sm whitespace-pre-wrap ${
                warn ? "text-amber-700 dark:text-amber-400" : ""
              }`}
            >
              {value}
            </p>
          </div>
        );
      })}
    </div>
  );
}

// Mind-map tree for 待处理: source video node → idea branches → expandable detail.
export function PendingIdeaTree({ groups, accountSlug, projectSlug }: Props) {
  return (
    <div className="flex flex-col gap-5">
      {groups.map((group, gi) => {
        const platform = group.sourceUrl ? inferPlatform(group.sourceUrl) : null;
        return (
          <StaggerItem key={group.key} index={gi}>
            <details open className="group">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg border bg-card/60 px-4 py-3 [&::-webkit-details-marker]:hidden">
                <span className="shrink-0 text-xs text-muted-foreground transition-transform group-open:rotate-90">
                  ▸
                </span>
                {platform ? (
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    {PLATFORM_LABEL[platform]}
                  </Badge>
                ) : null}
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {group.sourceUrl ? (
                    <a
                      href={xhsGoHref(group.sourceUrl)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {group.sourceTitle ?? group.sourceUrl}
                    </a>
                  ) : (
                    (group.sourceTitle ?? "来源已删除")
                  )}
                </span>
                {group.sourceChannelName ? (
                  <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                    {group.sourceChannelName}
                  </span>
                ) : null}
                <Badge variant="secondary" className="shrink-0 font-mono text-[10px]">
                  {group.ideas.length} 选题
                </Badge>
                {group.isLatestRun ? (
                  <Badge className="shrink-0 text-[10px]">本次巡视</Badge>
                ) : null}
              </summary>

              <div className="mt-2 ml-4 flex flex-col gap-2 border-l border-border pl-5">
                {group.ideas.map((idea) => (
                  <div
                    key={idea.id}
                    className="relative before:absolute before:top-6 before:-left-5 before:h-px before:w-4 before:bg-border"
                  >
                    <article className="flex flex-col rounded-lg border bg-card p-4">
                      <header className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 flex-col gap-1">
                          <span className="font-mono text-xs text-muted-foreground">
                            #{idea.ideaNumber}
                          </span>
                          <h3 className="text-sm font-medium whitespace-pre-wrap">
                            {idea.storyAngle ?? "—"}
                          </h3>
                        </div>
                        <IdeaActions
                          ideaId={idea.id}
                          state="pending"
                          accountSlug={accountSlug}
                          projectSlug={projectSlug}
                        />
                      </header>
                      <details className="group/detail mt-2">
                        <summary className="cursor-pointer list-none text-xs text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
                          <span className="group-open/detail:hidden">▸ 展开明细</span>
                          <span className="hidden group-open/detail:inline">▾ 收起明细</span>
                        </summary>
                        <IdeaDetailFields idea={idea} />
                      </details>
                    </article>
                  </div>
                ))}
              </div>
            </details>
          </StaggerItem>
        );
      })}
    </div>
  );
}
