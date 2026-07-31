"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useRealtimeRun } from "@trigger.dev/react-hooks";

import { AgentTimeline, type Stage } from "@/components/agent-timeline";
import { Button } from "@/components/ui/button";
import { friendlyRunError } from "@/lib/run-error";
import { trpc } from "@/lib/trpc";

const POET_BIBLE_STAGES: Stage[] = [
  { label: "AI 生成圣经", matches: (p) => p === "writing bible" },
];

const POET_SCRIPT_STAGES: Stage[] = [
  { label: "加载上下文", matches: (p) => p === "loading context" },
  {
    label: "AI 写稿 / 大纲",
    matches: (p) => p === "writing script" || p === "writing outline",
  },
  { label: "扩写分段", matches: (p) => /^expanding section/.test(p) },
  { label: "改写口语", matches: (p) => p === "humanizing script" },
  { label: "保存", matches: (p) => p === "saving script" },
];

const POET_ANALYZE_STAGES: Stage[] = [
  { label: "抓取外部素材", matches: (p) => p === "fetching references" },
  { label: "AI 拆解选题", matches: (p) => p === "analyzing topic" },
];

type ActiveRun = {
  runId: string;
  triggerRunId: string;
  publicAccessToken: string;
  kind: "bible" | "script" | "analyze";
};

type Props = {
  initialActive?: (ActiveRun & { startedAt?: Date | string }) | null;
  accountSlug: string;
  projectSlug: string;
};

type ProgressPayload = {
  current?: number;
  total?: number;
  phase?: string;
  detail?: string;
};

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m${r > 0 ? `${r}s` : ""}`;
}

function translatePhase(phase: string | undefined): string {
  if (!phase) return "准备中…";
  const map: Record<string, string> = {
    "writing bible": "AI 生成圣经中",
    "loading context": "加载上下文",
    "writing script": "AI 写稿中（短稿）",
    "writing outline": "AI 拆分长稿大纲",
    "humanizing script": "改写为真人口语",
    "saving script": "写入数据库",
    "fetching references": "抓取外部素材",
    "analyzing topic": "AI 拆解选题",
  };
  if (phase in map) return map[phase]!;
  const sectionMatch = phase.match(/^expanding section (\d+)\/(\d+)$/);
  if (sectionMatch) {
    return `AI 扩写长稿（第 ${sectionMatch[1]}/${sectionMatch[2]} 段）`;
  }
  return phase;
}

function runStatusLabel(status: string): string {
  const map: Record<string, string> = {
    FAILED: "失败",
    CANCELED: "已取消",
    CRASHED: "崩溃",
    SYSTEM_FAILURE: "系统错误",
    TIMED_OUT: "超时",
    EXPIRED: "过期",
  };
  return map[status] ?? status.toLowerCase().replace(/_/g, " ");
}

export function PoetRunProgress({ initialActive, accountSlug, projectSlug }: Props) {
  const router = useRouter();
  const utils = trpc.useUtils();
  // Skip settled run IDs — the server prop is briefly stale after onSettled until router.refresh lands.
  const [settledIds, setSettledIds] = useState<Set<string>>(new Set());
  const [mountedAt] = useState(() => Date.now());
  const active =
    initialActive && !settledIds.has(initialActive.triggerRunId) ? initialActive : null;
  const startedAt = active
    ? active.startedAt
      ? new Date(active.startedAt).getTime()
      : mountedAt
    : null;

  const cancel = trpc.pipeline.cancelRun.useMutation({
    onSuccess: () => {
      if (active) setSettledIds((prev) => new Set(prev).add(active.triggerRunId));
      toast.success("已取消");
      utils.invalidate();
      router.refresh();
    },
    onError: (err) => toast.error(err.message),
  });

  if (!active || !startedAt) return null;

  return (
    <ProgressCard
      active={active}
      startedAt={startedAt}
      onCancel={() => cancel.mutate({ runId: active.runId })}
      canceling={cancel.isPending}
      onProgressTick={() => {
        utils.invalidate();
        router.refresh();
      }}
      onSettled={(ok, message, scriptId) => {
        setSettledIds((prev) => new Set(prev).add(active.triggerRunId));
        if (ok) {
          const text = message ?? (active.kind === "bible" ? "圣经已生成" : "脚本已生成");
          if (scriptId) {
            toast.success(text, {
              action: {
                label: "查看脚本",
                onClick: () =>
                  router.push(
                    `/accounts/${encodeURIComponent(accountSlug)}/projects/${encodeURIComponent(projectSlug)}/poet/scripts/${scriptId}`,
                  ),
              },
            });
          } else {
            toast.success(text);
          }
          utils.invalidate();
          router.refresh();
        } else {
          toast.error(message ?? "运行失败", { duration: 10_000 });
        }
      }}
    />
  );
}

function ProgressCard({
  active,
  startedAt,
  onSettled,
  onProgressTick,
  onCancel,
  canceling,
}: {
  active: ActiveRun;
  startedAt: number;
  onSettled: (ok: boolean, message?: string, scriptId?: string) => void;
  onProgressTick: (phase: string | undefined) => void;
  onCancel?: () => void;
  canceling?: boolean;
}) {
  const { run, error } = useRealtimeRun(active.triggerRunId, {
    accessToken: active.publicAccessToken,
    throttleInMs: 500,
  });
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const phase = (run?.metadata?.progress as ProgressPayload | undefined)?.phase;
  const lastPhaseRef = useRef<string | undefined>(undefined);
  const tickRef = useRef(onProgressTick);
  useEffect(() => {
    tickRef.current = onProgressTick;
  });
  useEffect(() => {
    if (phase && phase !== lastPhaseRef.current) {
      lastPhaseRef.current = phase;
      tickRef.current(phase);
    }
  }, [phase]);

  useEffect(() => {
    if (error) {
      onSettled(false, friendlyRunError(error.message));
      return;
    }
    if (!run) return;
    if (run.status === "COMPLETED") {
      if (active.kind === "bible") {
        const out = run.output as
          | { drifted?: boolean; driftReason?: string | null; topicClaimed?: string }
          | undefined;
        if (out?.drifted) {
          onSettled(true, `圣经已生成，但检测到偏题（${out.driftReason ?? "请查看"}）`);
        } else {
          onSettled(true, `圣经已生成${out?.topicClaimed ? ` · ${out.topicClaimed}` : ""}`);
        }
      } else if (active.kind === "analyze") {
        const out = run.output as
          | { refsFetched?: number; refsFailed?: number }
          | undefined;
        const bits: string[] = ["选题已分析"];
        if (out?.refsFetched != null) bits.push(`抓取 ${out.refsFetched} 个素材`);
        if (out?.refsFailed) bits.push(`${out.refsFailed} 个失败`);
        onSettled(true, bits.join(" · "));
      } else {
        const out = run.output as
          | {
              wordCount?: number;
              targetWordCount?: number;
              path?: "short" | "long";
              humanized?: boolean;
              scriptId?: string | null;
            }
          | undefined;
        const bits: string[] = [];
        if (out?.path) bits.push(out.path === "long" ? "长稿" : "短稿");
        if (out?.wordCount) bits.push(`${out.wordCount} 字`);
        if (out?.humanized) bits.push("已口语化");
        onSettled(
          true,
          bits.length > 0 ? `脚本已生成 · ${bits.join(" · ")}` : "脚本已生成",
          out?.scriptId ?? undefined,
        );
      }
    } else if (
      run.status === "FAILED" ||
      run.status === "CANCELED" ||
      run.status === "CRASHED" ||
      run.status === "SYSTEM_FAILURE" ||
      run.status === "TIMED_OUT" ||
      run.status === "EXPIRED"
    ) {
      onSettled(false, friendlyRunError(run.error?.message) || `运行${runStatusLabel(run.status)}`);
    }
  }, [run, error, onSettled, active.kind]);

  const progress = run?.metadata?.progress as ProgressPayload | undefined;
  const phaseLabel = translatePhase(progress?.phase);
  const detail = progress?.detail;
  const current = progress?.current ?? 0;
  const total = progress?.total ?? 0;
  const elapsed = formatElapsed(now - startedAt);
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  const kindLabel =
    active.kind === "bible" ? "生成圣经" : active.kind === "analyze" ? "分析选题" : "写稿";
  const stages =
    active.kind === "bible"
      ? POET_BIBLE_STAGES
      : active.kind === "analyze"
        ? POET_ANALYZE_STAGES
        : POET_SCRIPT_STAGES;

  return (
    <div className="flex w-full flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="min-w-0 truncate font-medium text-foreground">
          {kindLabel} · {phaseLabel}
          <span className="font-normal text-muted-foreground"> · 完成前无法启动同 agent 新任务</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="font-mono text-muted-foreground">{elapsed}</span>
          {onCancel ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
              onClick={onCancel}
              disabled={canceling}
            >
              <X className="size-3" />
              {canceling ? "取消中…" : "取消"}
            </Button>
          ) : null}
        </span>
      </div>
      <AgentTimeline stages={stages} currentPhase={progress?.phase} accentClass="text-poet-deep" />
      {total > 0 ? (
        <div className="flex flex-col gap-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            {current === 0 ? (
              // Heartbeat for single-LLM windows (bible: total=1, current=0) — shimmer, not a frozen 0% bar.
              <div className="h-full w-1/3 animate-pulse bg-poet" />
            ) : (
              <div
                className="h-full bg-poet transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            )}
          </div>
          <div className="flex items-center justify-between font-mono text-[10px] text-muted-foreground">
            <span>
              {current}/{total}
            </span>
            <span>{current === 0 ? "进行中…" : `${pct}%`}</span>
          </div>
        </div>
      ) : (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full w-1/3 animate-pulse bg-poet" />
        </div>
      )}
      {detail ? <span className="line-clamp-2 text-xs text-muted-foreground">{detail}</span> : null}
    </div>
  );
}
