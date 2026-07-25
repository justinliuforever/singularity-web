"use client";

import { ExternalLink, Layers, Loader2, Play, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import type { ChannelSeries } from "@goooose/db";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { trpc } from "@/lib/trpc";

type Props = {
  channelId: string;
  initialSeries: ChannelSeries[];
};

const VIDEO_COUNT_OPTIONS = [30, 50, 100, 200] as const;

function formatViews(views: number): string {
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1)}M`;
  if (views >= 1_000) return `${(views / 1_000).toFixed(1)}K`;
  return String(views);
}

function formatDuration(sec: number): string {
  if (!sec) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return "—";
  }
}

export function ClerkSeriesPanel({ channelId, initialSeries }: Props) {
  const router = useRouter();
  const [videoCount, setVideoCount] = useState<(typeof VIDEO_COUNT_OPTIONS)[number]>(100);
  const [openSeries, setOpenSeries] = useState<ChannelSeries | null>(null);

  const listQuery = trpc.clerk.listSeries.useQuery(
    { channelId },
    { initialData: initialSeries, refetchOnWindowFocus: false },
  );
  const series = (listQuery.data ?? initialSeries) as ChannelSeries[];

  const utils = trpc.useUtils();
  const detect = trpc.clerk.detectSeries.useMutation({
    onSuccess: () => {
      toast.info("已开始扫描频道系列（约 1-2 分钟），完成后会自动刷新。");
      setTimeout(() => utils.clerk.listSeries.invalidate({ channelId }), 90_000);
    },
    onError: (err) => toast.error(err.message),
  });

  const startAnalysis = trpc.clerk.startAnalysis.useMutation({
    onSuccess: () => {
      toast.success("已针对该系列触发操盘小鹅分析");
      setOpenSeries(null);
      // Re-render the page so getActiveAgentRun picks up this run and ClerkRunButton
      // takes over progress tracking + completion refresh — otherwise the run is
      // untracked and results only appear after a manual reload.
      router.refresh();
    },
    onError: (err) => toast.error(err.message),
  });

  const hasSeries = series.length > 0;

  const analyzeSeries = (s: ChannelSeries) => {
    const ids = s.sampleVideos.slice(0, 50).map((v) => v.video_id);
    if (ids.length === 0) {
      toast.error("该系列没有可分析的视频");
      return;
    }
    startAnalysis.mutate({
      channelId,
      limit: ids.length,
      mode: "overwrite",
      source: "urls",
      videoIds: ids,
      language: "zh",
      recencyMonths: null,
    });
  };

  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Layers className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">频道系列</h2>
          {hasSeries ? (
            <Badge variant="secondary" className="font-mono text-[10px]">
              {series.length} 个
            </Badge>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {VIDEO_COUNT_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setVideoCount(n)}
                disabled={detect.isPending}
                className={`rounded-md border px-2 py-1 font-mono text-[10px] transition-colors ${
                  videoCount === n
                    ? "border-foreground bg-foreground/5"
                    : "hover:bg-muted/50"
                } disabled:opacity-50`}
              >
                {n}
              </button>
            ))}
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => detect.mutate({ channelId, videoCount, language: "zh" })}
            disabled={detect.isPending}
          >
            {detect.isPending ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <RefreshCw data-icon="inline-start" />
            )}
            {hasSeries ? `重新归类（${videoCount} 条）` : `扫描归类（${videoCount} 条）`}
          </Button>
        </div>
      </div>

      {!hasSeries ? (
        <p className="text-xs text-muted-foreground">
          频道系列归类会拉取近期视频，按常见主题归类（如教育 / 旅行 / 种草），帮你看清这个账号反复在做哪几类内容，再挑某一类做针对性 SOP 分析。这里是归纳已分析视频的共同点，不是给账号做大类目分类。点击数字选择拉取数量，再点扫描。
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {series.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setOpenSeries(s)}
              className="flex flex-col gap-1.5 rounded-md border bg-background p-3 text-left transition-colors hover:bg-muted/50"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{s.name}</span>
                <Badge variant="outline" className="font-mono text-[10px]">
                  {s.videoCount} 个
                </Badge>
              </div>
              {s.description ? (
                <p className="text-xs text-muted-foreground line-clamp-2">{s.description}</p>
              ) : null}
              {s.sampleVideos.length > 0 ? (
                <ul className="mt-1 flex flex-col gap-0.5 text-[11px] text-muted-foreground">
                  {s.sampleVideos.slice(0, 3).map((v) => (
                    <li key={v.video_id} className="truncate">
                      · {v.title}
                    </li>
                  ))}
                  {s.sampleVideos.length > 3 ? (
                    <li className="text-muted-foreground/60">
                      + {s.sampleVideos.length - 3} 个 · 点击查看
                    </li>
                  ) : null}
                </ul>
              ) : null}
            </button>
          ))}
        </div>
      )}

      <Sheet open={openSeries !== null} onOpenChange={(o) => !o && setOpenSeries(null)}>
        <SheetContent className="flex w-full flex-col gap-0 sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{openSeries?.name}</SheetTitle>
            {openSeries?.description ? (
              <SheetDescription className="text-sm">{openSeries.description}</SheetDescription>
            ) : null}
            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="secondary" className="font-mono text-[10px]">
                {openSeries?.videoCount ?? 0} 个视频
              </Badge>
              <span className="font-mono">
                Top {openSeries?.sampleVideos.length ?? 0} 留存
              </span>
            </div>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-4 py-4">
            <ul className="flex flex-col gap-2">
              {openSeries?.sampleVideos.map((v) => (
                <li
                  key={v.video_id}
                  className="flex flex-col gap-1 rounded-md border bg-background p-3 text-sm"
                >
                  <a
                    href={`https://www.youtube.com/watch?v=${v.video_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-1.5 font-medium hover:text-foreground hover:underline"
                  >
                    <span className="line-clamp-2 flex-1">{v.title}</span>
                    <ExternalLink className="size-3 shrink-0 translate-y-0.5 text-muted-foreground" />
                  </a>
                  <div className="flex items-center gap-3 font-mono text-[10px] text-muted-foreground">
                    <span>{formatViews(v.views)} 播放</span>
                    <span>·</span>
                    <span>{formatDuration(v.duration_sec)}</span>
                    <span>·</span>
                    <span>{formatDate(v.published_at)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <SheetFooter>
            <Button
              onClick={() => openSeries && analyzeSeries(openSeries)}
              disabled={startAnalysis.isPending || !openSeries}
            >
              {startAnalysis.isPending ? (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              ) : (
                <Play data-icon="inline-start" />
              )}
              针对此系列做 SOP（最多 {Math.min(openSeries?.sampleVideos.length ?? 0, 50)} 个视频）
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </section>
  );
}
