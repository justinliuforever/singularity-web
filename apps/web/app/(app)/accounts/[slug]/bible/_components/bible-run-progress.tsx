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

// Not PoetRunProgress: that one needs a projectSlug, and this page has none.
const BIBLE_STAGES: Stage[] = [
  { label: "读取文件", matches: (p) => p === "loading file" },
  { label: "转写文档", matches: (p) => p === "transcribing document" },
  { label: "复核数字", matches: (p) => p === "verifying chart numbers" },
  { label: "AI 生成圣经", matches: (p) => p === "writing bible" || p === "saving" },
];

type ActiveRun = {
  runId: string;
  triggerRunId: string;
  publicAccessToken: string;
  startedAt?: Date | string;
};

type Props = {
  initialActive?: ActiveRun | null;
};

type ProgressPayload = {
  current?: number;
  total?: number;
  phase?: string;
  detail?: string;
};

const TERMINAL_STATUS = new Set([
  "FAILED",
  "CANCELED",
  "CRASHED",
  "SYSTEM_FAILURE",
  "TIMED_OUT",
  "EXPIRED",
]);

const STATUS_LABEL: Record<string, string> = {
  FAILED: "失败",
  CANCELED: "已取消",
  CRASHED: "崩溃",
  SYSTEM_FAILURE: "系统错误",
  TIMED_OUT: "超时",
  EXPIRED: "过期",
};

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m${r > 0 ? `${r}s` : ""}`;
}

export function BibleRunProgress({ initialActive }: Props) {
  const router = useRouter();
  const utils = trpc.useUtils();
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

  function onSettled(ok: boolean, message?: string) {
    if (active) setSettledIds((prev) => new Set(prev).add(active.triggerRunId));
    if (ok) {
      toast.success(message ?? "圣经已生成");
    } else {
      toast.error(message ?? "运行失败", { duration: 10_000 });
    }
    // Refresh the persistent header bible chip (channels.context) and this server page.
    void utils.channels.context.invalidate();
    utils.invalidate();
    router.refresh();
  }

  if (!active || !startedAt) return null;

  return (
    <ProgressCard
      triggerRunId={active.triggerRunId}
      accessToken={active.publicAccessToken}
      startedAt={startedAt}
      onCancel={() => cancel.mutate({ runId: active.runId })}
      canceling={cancel.isPending}
      onSettled={onSettled}
    />
  );
}

function ProgressCard({
  triggerRunId,
  accessToken,
  startedAt,
  onSettled,
  onCancel,
  canceling,
}: {
  triggerRunId: string;
  accessToken: string;
  startedAt: number;
  onSettled: (ok: boolean, message?: string) => void;
  onCancel?: () => void;
  canceling?: boolean;
}) {
  const { run, error } = useRealtimeRun(triggerRunId, {
    accessToken,
    throttleInMs: 500,
  });
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const settledRef = useRef(onSettled);
  useEffect(() => {
    settledRef.current = onSettled;
  });
  useEffect(() => {
    if (error) {
      settledRef.current(false, friendlyRunError(error.message));
      return;
    }
    if (!run) return;
    if (run.status === "COMPLETED") {
      const out = run.output as
        | {
            drifted?: boolean;
            driftReason?: string | null;
            topicClaimed?: string;
            needsReview?: boolean;
            flagCount?: number;
          }
        | undefined;
      if (out?.needsReview) {
        settledRef.current(true, `圣经已导入，有 ${out.flagCount ?? 0} 个存疑项待确认 — 逐项确认后才能激活`);
      } else if (out?.drifted) {
        settledRef.current(true, `圣经已生成，但检测到偏题（${out.driftReason ?? "请查看"}）`);
      } else {
        settledRef.current(true, `圣经已生成${out?.topicClaimed ? ` · ${out.topicClaimed}` : ""}`);
      }
    } else if (TERMINAL_STATUS.has(run.status)) {
      settledRef.current(false, friendlyRunError(run.error?.message) || `运行${STATUS_LABEL[run.status] ?? run.status}`);
    }
  }, [run, error]);

  const progress = run?.metadata?.progress as ProgressPayload | undefined;
  const detail = progress?.detail;
  const elapsed = formatElapsed(now - startedAt);

  return (
    <div className="flex w-full flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="min-w-0 truncate font-medium text-foreground">
          生成圣经 ·{" "}
          {progress?.phase === "writing bible"
            ? "AI 生成圣经中"
            : progress?.phase === "transcribing document"
              ? "转写文档中"
              : progress?.phase === "loading file"
                ? "读取文件中"
                : progress?.phase === "saving"
                  ? "保存中"
                  : "准备中…"}
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
      <AgentTimeline stages={BIBLE_STAGES} currentPhase={progress?.phase} accentClass="text-poet-deep" />
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        {(progress?.phase === "transcribing document" || progress?.phase === "verifying chart numbers") &&
        (progress?.total ?? 0) > 1 ? (
          <div
            className="h-full bg-poet transition-all"
            style={{ width: `${Math.min(100, Math.round(((progress?.current ?? 0) / (progress?.total ?? 1)) * 100))}%` }}
          />
        ) : (
          <div className="h-full w-1/3 animate-pulse bg-poet" />
        )}
      </div>
      {detail ? <span className="line-clamp-2 text-xs text-muted-foreground">{detail}</span> : null}
    </div>
  );
}
