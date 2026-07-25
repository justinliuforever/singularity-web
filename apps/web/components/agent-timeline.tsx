"use client";

import { Check, Loader2 } from "lucide-react";

export type Stage = {
  label: string;
  matches: (phase: string) => boolean;
};

type Props = {
  stages: Stage[];
  currentPhase: string | undefined;
  allDone?: boolean;
  /** Tailwind text color class, e.g. "text-clerk" / "text-muse" / "text-poet". */
  accentClass?: string;
};

export function AgentTimeline({
  stages,
  currentPhase,
  allDone,
  accentClass = "text-foreground",
}: Props) {
  let currentIndex = -1;
  if (!allDone && currentPhase) {
    currentIndex = stages.findIndex((s) => s.matches(currentPhase));
  }

  return (
    <ol className="flex flex-col gap-1.5 text-xs">
      {stages.map((s, i) => {
        const isDone = allDone || (currentIndex > i || currentIndex === -1 && allDone);
        const isCurrent = !allDone && i === currentIndex;
        return (
          <li key={s.label} className="flex items-center gap-2">
            <span className="inline-flex size-4 shrink-0 items-center justify-center">
              {isDone ? (
                <Check className={`size-3.5 ${accentClass}`} />
              ) : isCurrent ? (
                <Loader2 className={`size-3.5 animate-spin ${accentClass}`} />
              ) : (
                <span className="size-2 rounded-full border border-muted-foreground/40" />
              )}
            </span>
            <span
              className={
                isDone || isCurrent
                  ? "text-foreground"
                  : "text-muted-foreground"
              }
            >
              {s.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
