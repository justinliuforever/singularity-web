"use client";

import { Check, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { EtaHint } from "@/components/eta-hint";

import { ActivityLog, type LogEntry } from "./activity-log";
import { LiveVideoTracks, type VideoTrack } from "./live-video-tracks";

type Stage = {
  id: string;
  label: string;
  matches: (phase: string) => boolean;
};

const CLERK_STAGES: Stage[] = [
  {
    id: "resolve",
    label: "解析频道 / 视频",
    matches: (p) =>
      p === "resolving channel" || p === "resolving videos" || p === "fetching videos",
  },
  {
    id: "metadata",
    label: "抓取视频元数据",
    matches: (p) =>
      p === "fetching video metadata" ||
      p === "fetching transcript" ||
      p === "transcribing audio",
  },
  {
    id: "analyze",
    label: "AI 分析视频",
    matches: (p) =>
      p === "running analyzer" ||
      p === "running analyzer (no caption)" ||
      p === "analyzing thumbnail" ||
      p === "writing analysis" ||
      p === "processing videos",
  },
  {
    id: "sops",
    label: "生成 SOP",
    matches: (p) =>
      p === "compiling videos data" ||
      p === "generating human SOP" ||
      p === "generating AI reference SOP" ||
      p === "generating hottest video deep dive" ||
      p === "generating SOPs",
  },
];

type Props = {
  phase: string | undefined;
  detail: string | undefined;
  current: number;
  total: number;
  fracDone?: number;
  estSecondsRemaining?: number;
  startedAt: number;
  log: LogEntry[];
  videoTracks: Record<string, VideoTrack>;
  allDone?: boolean;
  onCancel?: () => void;
  canceling?: boolean;
};

function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function ClerkPipelineProgress({
  phase,
  detail,
  current,
  total,
  fracDone,
  estSecondsRemaining,
  startedAt,
  log,
  videoTracks,
  allDone,
  onCancel,
  canceling,
}: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (allDone) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [allDone]);

  const currentIdx = phase ? CLERK_STAGES.findIndex((s) => s.matches(phase)) : -1;

  const elapsed = now - startedAt;
  // Duration-weighted fill when the job emits it (a 60-min video ≠ a 30s note); count fallback.
  const fraction = fracDone ?? (total > 0 ? current / total : 0);
  const pct = Math.round(Math.min(fraction, 1) * 100);
  const isAnalyzeStage = currentIdx === 2;
  const showTracks = isAnalyzeStage && Object.keys(videoTracks).length > 0;

  return (
    <div className="flex w-full flex-col gap-3 rounded-lg border bg-card p-4 text-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {allDone ? (
            <Check className="size-4.5 shrink-0 text-clerk-deep" />
          ) : (
            <Loader2 className="size-4 shrink-0 animate-spin text-clerk-deep" />
          )}
          <span className="text-sm font-medium text-foreground">
            {allDone ? "分析完成" : phase ? "分析中" : "准备中…"}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            · 完成前无法启动新的分析任务
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {!allDone ? (
            <EtaHint
              jobKey="clerk.analyze"
              count={total}
              liveSec={estSecondsRemaining}
              fraction={fraction}
            />
          ) : null}
          <span className="font-mono text-xs text-muted-foreground">{fmtElapsed(elapsed)}</span>
          {onCancel && !allDone ? (
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
        </div>
      </div>

      {total > 0 ? (
        <div className="flex flex-col gap-1.5">
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            {current === 0 && !allDone ? (
              // Cold-window heartbeat: indeterminate shimmer instead of a frozen 0% bar until the first result lands.
              <div className="h-full w-1/3 animate-pulse bg-clerk" />
            ) : (
              <div
                className="h-full bg-clerk transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            )}
          </div>
          <div className="flex items-center justify-between font-mono text-xs text-muted-foreground">
            <span>
              {current}/{total}
            </span>
            <span>{current === 0 && !allDone ? "进行中…" : `${pct}%`}</span>
          </div>
        </div>
      ) : null}

      <ol className="flex flex-col gap-2.5">
        {CLERK_STAGES.map((s, i) => {
          const isDone = allDone || i < currentIdx;
          const isCurrent = !allDone && i === currentIdx;
          return (
            <li key={s.id} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2.5">
                <span className="inline-flex size-5 shrink-0 items-center justify-center">
                  {isDone ? (
                    <Check className="size-4 text-clerk-deep" />
                  ) : isCurrent ? (
                    <Loader2 className="size-4 animate-spin text-clerk-deep" />
                  ) : (
                    <span className="size-2.5 rounded-full border border-muted-foreground/40" />
                  )}
                </span>
                <span
                  className={
                    isDone || isCurrent ? "text-sm text-foreground" : "text-sm text-muted-foreground"
                  }
                >
                  {s.label}
                </span>
              </div>
              {isCurrent && detail ? (
                <span className="ml-7 line-clamp-2 text-xs text-muted-foreground">
                  {detail}
                </span>
              ) : null}
              {isCurrent && showTracks ? (
                <div className="ml-7">
                  <LiveVideoTracks tracks={videoTracks} now={now} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      <ActivityLog entries={log} defaultOpen={false} />
    </div>
  );
}
