"use client";

import { useState } from "react";

import { clampEta, formatEtaRange } from "@/lib/eta";
import { coldStartRange, type EtaJobKey } from "@/lib/eta-jobs";
import { trpc } from "@/lib/trpc";

// Always a range, never a countdown, and silent when the band is too wide — a precise
// number that later moves reads as broken.
export function EtaHint({
  jobKey,
  count,
  liveSec,
  fraction,
}: {
  jobKey: EtaJobKey;
  count?: number;
  liveSec?: number;
  fraction?: number;
}) {
  const { data } = trpc.pipeline.etaHints.useQuery({ jobKey }, { staleTime: 300_000 });
  const t1 = data && data.n >= 5 && data.p90Sec > 0 ? { p50: data.p50Sec, p90: data.p90Sec } : null;

  // Setting state during render is the intended "derived state with memory" pattern here:
  // clampEta needs the previously displayed value, which an effect would apply a frame late.
  const [display, setDisplay] = useState<number | null>(null);
  const liveGated = fraction == null || fraction >= 0.1;
  if (liveSec != null && liveSec > 0 && liveGated) {
    let v = liveSec;
    if (t1 && fraction != null && fraction < 0.4) {
      v = Math.round(0.7 * t1.p50 * (1 - fraction) + 0.3 * liveSec);
    }
    const next = clampEta(display, v, t1 ? t1.p90 : Infinity);
    if (next !== display) setDisplay(next);
  }

  if (display != null && display > 0) {
    return (
      <span className="font-mono text-[10px] text-muted-foreground">
        预计 {formatEtaRange(display * 0.8, display * 1.35)}
      </span>
    );
  }

  const range = t1 ? { lo: t1.p50, hi: t1.p90 } : coldStartRange(jobKey, count);

  if (!range || range.hi <= 0) return null;
  if (range.lo > 0 && range.hi > range.lo * 4) return null; // variance too high → rely on step

  return (
    <span className="font-mono text-[10px] text-muted-foreground">预计 {formatEtaRange(range.lo, range.hi)}</span>
  );
}
