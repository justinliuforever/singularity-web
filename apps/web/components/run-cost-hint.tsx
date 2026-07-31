"use client";

import { trpc } from "@/lib/trpc";

// byContent runs charge nothing at trigger and settle at the end, so without this the first
// signal of a 264-minute run is the balance afterwards. The number must be the same one
// assertRunQuota gates on, or the sheet promises a cost the server then rejects.
export function RunCostHint({ estimateMinutes }: { estimateMinutes: number }) {
  const usage = trpc.access.myUsage.useQuery();
  const m = usage.data?.minutes;
  const remaining = m ? m.base + m.bonus - m.used : null;
  const short = remaining !== null && estimateMinutes > 0 && remaining < estimateMinutes;

  if (estimateMinutes <= 0) return null;
  return (
    <p className={`text-xs ${short ? "text-destructive" : "text-muted-foreground"}`}>
      预计消耗 {estimateMinutes} 配额分钟
      {remaining !== null ? ` · 本月剩余 ${Math.max(remaining, 0)} 分钟` : ""}
      {short ? " · 额度不足，启动会被拒绝" : ""}
    </p>
  );
}
