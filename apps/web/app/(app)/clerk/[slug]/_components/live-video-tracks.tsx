"use client";

import { Check, Loader2, X } from "lucide-react";

export type VideoTrack = { title: string; phase: string; startedAt: number };

type Props = {
  tracks: Record<string, VideoTrack>;
  now: number;
};

const ACTIVE_PHASES = new Set([
  "fetching metadata",
  "transcribing",
  "AI 分析",
]);

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function LiveVideoTracks({ tracks, now }: Props) {
  const entries = Object.entries(tracks);
  if (entries.length === 0) return null;
  const visible = entries.sort(([, a], [, b]) => {
    const aActive = ACTIVE_PHASES.has(a.phase) ? 0 : 1;
    const bActive = ACTIVE_PHASES.has(b.phase) ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return b.startedAt - a.startedAt;
  });

  return (
    <div className="grid max-h-44 grid-cols-1 gap-1 overflow-y-auto rounded-md border bg-muted/30 px-2 py-2 sm:grid-cols-2">
      {visible.map(([id, t]) => {
        const elapsed = now - t.startedAt;
        const isActive = ACTIVE_PHASES.has(t.phase);
        const isDone = t.phase === "done";
        const isFailed = t.phase === "failed";
        return (
          <div
            key={id}
            className="flex min-w-0 items-center gap-1.5 rounded bg-background px-2 py-1 text-[10px]"
          >
            <span className="shrink-0">
              {isDone ? (
                <Check className="size-3 text-green-600" />
              ) : isFailed ? (
                <X className="size-3 text-destructive" />
              ) : isActive ? (
                <Loader2 className="size-3 animate-spin text-clerk-deep" />
              ) : (
                <span className="size-2 rounded-full border border-muted-foreground/40" />
              )}
            </span>
            <span className="truncate text-foreground/80" title={t.title}>
              {t.title}
            </span>
            <span className="ml-auto shrink-0 font-mono text-muted-foreground">
              {isActive ? formatDuration(elapsed) : isDone ? "✓" : isFailed ? "✗" : ""}
            </span>
            <span className="shrink-0 truncate text-muted-foreground/70">{t.phase}</span>
          </div>
        );
      })}
    </div>
  );
}
