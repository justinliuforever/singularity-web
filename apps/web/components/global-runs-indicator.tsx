"use client";

import { useRouter } from "next/navigation";
import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { AnimatedNumber } from "@/components/animated-number";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { AGENT_LABEL, COMMAND_LABEL, runBadgeLabel } from "@/lib/run-labels";

// Default project slug == account slug, so agent pages deep-link off channelSlug.
// Competitor-target clerk runs (no slug) link to the competitor analysis page.
function deepLink(run: { agent: string; channelSlug: string | null; competitorAccountId: string | null }): string {
  if (run.competitorAccountId) return `/clerk/competitor/${run.competitorAccountId}`;
  const s = encodeURIComponent(run.channelSlug ?? "");
  if (run.agent === "clerk") return `/clerk/${s}`;
  if (run.agent === "muse" || run.agent === "poet") return `/accounts/${s}/projects/${s}/${run.agent}`;
  return "/";
}

function elapsed(now: number, startedAt: Date | string): string {
  const min = Math.floor((now - new Date(startedAt).getTime()) / 60_000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟`;
  const h = Math.floor(min / 60);
  return `${h}h${min % 60}m`;
}

type RunRow = {
  id: string;
  agent: string;
  command: string;
  status: string;
  startedAt: Date | string;
  progress: number | null;
  total: number | null;
  channelSlug: string | null;
  competitorAccountId: string | null;
  targetName: string;
};

function GlobalRunsIndicatorInner() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Hand-rolled popover (no portal, no menu semantics): plain conditional div with
  // outside-click + Escape dismissal — nothing here can take down the page.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Idle sessions were the bulk of all traffic: poll fast only while something is running,
  // and keep a slow tick so a run started elsewhere still surfaces without a focus event.
  const listQuery = trpc.pipeline.listActiveAll.useQuery(undefined, {
    refetchInterval: (q) => (q.state.data?.length ? 8_000 : 60_000),
    refetchOnWindowFocus: true,
  });
  const runs: RunRow[] = listQuery.data ?? [];

  // Cross-page finish notification: when a previously-seen run id leaves the active set,
  // surface a toast with a deep link. Skip the first load (no baseline to diff against).
  const prevRef = useRef<Map<string, RunRow> | null>(null);
  useEffect(() => {
    if (!listQuery.data) return;
    const current = new Map(listQuery.data.map((r) => [r.id, r]));
    const prev = prevRef.current;
    prevRef.current = current;
    if (!prev) return;
    for (const [id, r] of prev) {
      if (current.has(id)) continue;
      toast(`${AGENT_LABEL[r.agent] ?? r.agent} · ${COMMAND_LABEL[r.command] ?? r.command} 已结束`, {
        description: r.targetName,
        action: {
          label: "查看",
          onClick: () => router.push(deepLink(r)),
        },
      });
    }
  }, [listQuery.data, router]);

  if (runs.length === 0) return null;

  return (
    <motion.div
      ref={wrapRef}
      className="relative"
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
    >
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 px-2"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Loader2 className="size-3.5 animate-spin text-amber-600" />
        {/* Keyed remount pops the count on every change — peripheral cue that a run started/finished. */}
        <motion.span
          key={runs.length}
          initial={{ scale: 0.5, opacity: 0.4 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 500, damping: 22 }}
          className="font-mono text-xs"
        >
          {runs.length}
        </motion.span>
        <span className="hidden text-xs text-muted-foreground sm:inline">任务运行中</span>
      </Button>
      <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0, y: -4, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -4, scale: 0.98 }}
          transition={{ duration: 0.15 }}
          className="absolute top-full right-0 z-50 mt-1.5 w-80 rounded-md border bg-popover p-1.5 text-popover-foreground shadow-md"
        >
          <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">运行中的任务</p>
          <div className="flex flex-col gap-0.5">
            {runs.map((r) => (
              <div key={r.id} className="flex flex-col gap-1 rounded-md px-2 py-2 text-sm">
                <span className="flex w-full items-center gap-2">
                  <Badge variant="outline" className="font-mono text-[10px] uppercase">
                    {runBadgeLabel(r.agent, r.command)}
                  </Badge>
                  {/* Bible badge already reads 频道圣经 — skip the redundant command label. */}
                  {r.command !== "poet-generate-bible" ? (
                    <span className="text-xs">{COMMAND_LABEL[r.command] ?? r.command}</span>
                  ) : null}
                  <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                    {r.status === "pending" ? "待启动" : elapsed(now, r.startedAt)}
                  </span>
                </span>
                <span className="flex w-full items-center gap-2">
                  <span className="truncate text-[11px] text-muted-foreground">
                    {r.targetName}
                  </span>
                  {r.status === "running" && (r.total ?? 0) > 0 ? (
                    <span className="ml-auto flex shrink-0 items-center gap-1.5">
                      <span className="h-1 w-14 overflow-hidden rounded-full bg-muted">
                        <span
                          className="block h-full rounded-full bg-amber-500 transition-all duration-500"
                          style={{
                            width: `${Math.min(100, Math.round(((r.progress ?? 0) / (r.total ?? 1)) * 100))}%`,
                          }}
                        />
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        <AnimatedNumber value={r.progress ?? 0} />/{r.total}
                      </span>
                    </span>
                  ) : (
                    <Loader2 className="ml-auto size-3 animate-spin text-amber-600" />
                  )}
                </span>
              </div>
            ))}
          </div>
        </motion.div>
      ) : null}
      </AnimatePresence>
    </motion.div>
  );
}

// A status indicator must never be able to take the page down with it: any render
// error inside collapses to "no indicator" instead of the route error screen.
class IndicatorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function GlobalRunsIndicator() {
  return (
    <IndicatorBoundary>
      <GlobalRunsIndicatorInner />
    </IndicatorBoundary>
  );
}
