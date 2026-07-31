"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useRealtimeRun } from "@trigger.dev/react-hooks";

import { useVisibleRefresh } from "@/hooks/use-visible-refresh";
import { trpc } from "@/lib/trpc";

import { ClerkPipelineProgress } from "./clerk-pipeline-progress";
import { ClerkStartSheet, type ClerkTarget } from "./clerk-start-sheet";
import type { LogEntry } from "./activity-log";
import type { VideoTrack } from "./live-video-tracks";

type ActiveRun = {
  runId: string;
  triggerRunId: string;
  publicAccessToken: string;
};

type Props = {
  target: ClerkTarget;
  channelName: string;
  // Own targets only — powers the「去生成圣经」finish action.
  channelSlug?: string;
  platform: "youtube" | "xhs" | "douyin";
  initialActive?: (ActiveRun & { startedAt?: Date | string }) | null;
  // Another clerk command is running: the lock is agent-wide, so starting would be rejected.
  lockedByOtherRun?: boolean;
};

export function ClerkRunButton({
  target,
  channelName,
  channelSlug,
  platform,
  initialActive,
  lockedByOtherRun,
}: Props) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [active, setActive] = useState<ActiveRun | null>(initialActive ?? null);
  const [startedAt, setStartedAt] = useState<number | null>(() =>
    initialActive?.startedAt
      ? new Date(initialActive.startedAt).getTime()
      : initialActive
        ? Date.now()
        : null,
  );

  const cancel = trpc.pipeline.cancelRun.useMutation({
    onSuccess: () => {
      setActive(null);
      setStartedAt(null);
      toast.success("已取消分析");
      utils.invalidate();
      router.refresh();
    },
    onError: (err) => toast.error(err.message),
  });

  if (!active || !startedAt) {
    return (
      <div className="flex justify-end">
        <ClerkStartSheet
          target={target}
          channelName={channelName}
          platform={platform}
          disabled={!!lockedByOtherRun}
          onStarted={(run) => {
            setActive(run);
            setStartedAt(Date.now());
          }}
        />
      </div>
    );
  }

  return (
    <ClerkRunProgress
      triggerRunId={active.triggerRunId}
      accessToken={active.publicAccessToken}
      startedAt={startedAt}
      onCancel={() => cancel.mutate({ runId: active.runId })}
      canceling={cancel.isPending}
      // Mid-run only the server-rendered table moves; the tRPC queries on this page settle at
      // start and end, so a bare invalidate() here just refetches them on every tick.
      onProgressTick={() => router.refresh()}
      onSettled={(ok, message) => {
        setActive(null);
        setStartedAt(null);
        if (ok) {
          toast.success(message ?? "分析完成", {
            action:
              target.kind === "own" && channelSlug
                ? {
                    label: "去生成圣经",
                    onClick: () =>
                      router.push(`/accounts/${encodeURIComponent(channelSlug)}/bible`),
                  }
                : {
                    label: "去 SOP 库",
                    onClick: () => router.push("/sops"),
                  },
          });
          utils.invalidate();
          router.refresh();
        } else {
          toast.error(message ?? "分析失败");
        }
      }}
    />
  );
}

type ProgressPayload = {
  current?: number;
  total?: number;
  phase?: string;
  phaseLabel?: string;
  detail?: string;
  fracDone?: number;
  estSecondsRemaining?: number;
};

function ClerkRunProgress({
  triggerRunId,
  accessToken,
  startedAt,
  onSettled,
  onProgressTick,
  onCancel,
  canceling,
}: {
  triggerRunId: string;
  accessToken: string;
  startedAt: number;
  onSettled: (ok: boolean, message?: string) => void;
  onProgressTick: (phase: string | undefined) => void;
  onCancel?: () => void;
  canceling?: boolean;
}) {
  const { run, error } = useRealtimeRun(triggerRunId, {
    accessToken,
    throttleInMs: 500,
  });

  // Depending on inline callback refs (new each render) causes a refresh loop.
  const progressMeta = run?.metadata?.progress as ProgressPayload | undefined;
  const phase = progressMeta?.phase;
  const current = progressMeta?.current;
  const lastPhaseRef = useRef<string | undefined>(undefined);
  const lastKeyRef = useRef<string | undefined>(undefined);
  const tickRef = useRef(onProgressTick);
  useEffect(() => {
    tickRef.current = onProgressTick;
  });
  const requestRefresh = useVisibleRefresh(() => tickRef.current(lastPhaseRef.current));

  // Rows land within one phase, so phase alone leaves the table stale. `current` is not
  // monotonic — concurrent items re-emit a stale base — so this over-fires, never misses.
  useEffect(() => {
    if (phase === undefined && current === undefined) return;
    const key = `${phase ?? ""}:${current ?? ""}`;
    if (key === lastKeyRef.current) return;
    lastKeyRef.current = key;
    lastPhaseRef.current = phase;
    requestRefresh();
  }, [phase, current, requestRefresh]);

  useEffect(() => {
    if (error) {
      onSettled(false, `错误：${error.message}`);
      return;
    }
    if (!run) return;
    if (run.status === "COMPLETED") {
      const out = run.output as
        | { analyzed?: number; total?: number; failed?: number; sopsGenerated?: number }
        | undefined;
      onSettled(
        true,
        `已分析 ${out?.analyzed ?? 0}/${out?.total ?? 0} 条内容${
          out?.failed ? `（${out.failed} 个失败）` : ""
        }${out?.sopsGenerated ? ` · 生成 ${out.sopsGenerated} 个 SOP` : ""}`,
      );
    } else if (
      run.status === "FAILED" ||
      run.status === "CANCELED" ||
      run.status === "CRASHED" ||
      run.status === "SYSTEM_FAILURE" ||
      run.status === "TIMED_OUT" ||
      run.status === "EXPIRED"
    ) {
      onSettled(false, run.error?.message ?? `运行${runStatusLabel(run.status)}`);
    }
  }, [run, error, onSettled]);

  const progress = run?.metadata?.progress as ProgressPayload | undefined;
  const log = (run?.metadata?.log as LogEntry[] | undefined) ?? [];
  const videoTracks =
    (run?.metadata?.videoTracks as Record<string, VideoTrack> | undefined) ?? {};

  return (
    <ClerkPipelineProgress
      phase={progress?.phase}
      detail={progress?.detail}
      current={progress?.current ?? 0}
      total={progress?.total ?? 0}
      fracDone={progress?.fracDone}
      estSecondsRemaining={progress?.estSecondsRemaining}
      startedAt={startedAt}
      log={log}
      videoTracks={videoTracks}
      allDone={run?.status === "COMPLETED"}
      onCancel={onCancel}
      canceling={canceling}
    />
  );
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
