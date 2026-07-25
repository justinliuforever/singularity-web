"use client";

import { Loader2, Play } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { estimateRunMinutes } from "@/lib/run-estimate";
import { trpc } from "@/lib/trpc";

type Source = "newest" | "popular" | "urls";
type Mode = "overwrite" | "incremental";
type Recency = "1" | "3" | "6" | "all";
type Language = "zh" | "en";

type ActiveRun = {
  runId: string;
  triggerRunId: string;
  publicAccessToken: string;
};

export type ClerkTarget =
  | { kind: "own"; channelId: string }
  | { kind: "competitor"; competitorAccountId: string };

type Props = {
  target: ClerkTarget;
  channelName: string;
  platform: "youtube" | "xhs" | "douyin";
  disabled: boolean;
  onStarted: (run: ActiveRun) => void;
};

const RECENCY_OPTIONS: Array<{ value: Recency; label: string }> = [
  { value: "1", label: "近 1 月" },
  { value: "3", label: "近 3 月" },
  { value: "6", label: "近 6 月" },
  { value: "all", label: "不限" },
];

const LANGUAGE_OPTIONS: Array<{ value: Language; label: string; hint: string }> = [
  { value: "zh", label: "中文 SOP", hint: "适合中文频道" },
  { value: "en", label: "English SOP", hint: "适合英文频道" },
];

const SOURCE_OPTIONS_YT: Array<{ value: Source; label: string; hint: string }> = [
  { value: "newest", label: "最新发布", hint: "频道最新发布的 N 个视频" },
  { value: "popular", label: "近期热门", hint: "近期发布里播放量最高的 N 个（看不到老爆款）" },
  { value: "urls", label: "指定链接", hint: "粘 YouTube 视频 URL，每行一个" },
];

const SOURCE_OPTIONS_XHS: Array<{ value: Source; label: string; hint: string }> = [
  { value: "newest", label: "最新笔记", hint: "频道最新发布的 N 篇笔记" },
  { value: "popular", label: "互动最高", hint: "近期笔记里互动分（点赞+收藏+评论+转发加权）最高的 N 篇" },
  { value: "urls", label: "指定链接", hint: "粘小红书笔记 URL，每行一个" },
];

const SOURCE_OPTIONS_DOUYIN: Array<{ value: Source; label: string; hint: string }> = [
  { value: "newest", label: "最新作品", hint: "账号最新发布的 N 个作品" },
  { value: "popular", label: "热门作品", hint: "近期作品里按互动分最高的 N 个" },
  { value: "urls", label: "指定链接", hint: "粘抖音作品 URL，每行一个" },
];

const MODE_OPTIONS: Array<{ value: Mode; label: string; hint: string }> = [
  { value: "overwrite", label: "从头分析", hint: "覆盖该视频已有的分析结果" },
  { value: "incremental", label: "仅新视频", hint: "跳过已经分析过的视频" },
];

// Mirror the worker's id extraction (xhs.ts / analyze-channel.ts) so a paste that can't
// resolve to a note/video id is caught before the run — including share-card text blobs
// where the URL is wrapped in title/emoji.
function lineResolvesToId(line: string, platform: "youtube" | "xhs" | "douyin"): boolean {
  if (platform === "xhs") {
    return (
      /^[a-f0-9]{16,32}$/i.test(line) ||
      /(?:explore|discovery\/item)\/[a-f0-9]{16,32}/i.test(line) ||
      // Mobile share short links can't be resolved in the browser; the worker
      // expands the redirect server-side.
      /https?:\/\/(?:[\w-]+\.)?xhslink\.com\//i.test(line)
    );
  }
  if (platform === "douyin") {
    return (
      /\/video\/\d{15,21}/.test(line) ||
      /iesdouyin\.com\/share\/video\/\d+/i.test(line) ||
      // Mobile share short links resolve server-side.
      /https?:\/\/v\.douyin\.com\/[A-Za-z0-9_-]+/i.test(line) ||
      /^\d{19}$/.test(line)
    );
  }
  return (
    /^[A-Za-z0-9_-]{11}$/.test(line) ||
    /[?&]v=[A-Za-z0-9_-]{11}/.test(line) ||
    /(?:youtu\.be|\/shorts|\/live|\/embed|\/v)\/[A-Za-z0-9_-]{11}/.test(line)
  );
}

export function ClerkStartSheet({
  target,
  channelName,
  platform,
  disabled,
  onStarted,
}: Props) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<Source>("newest");
  const [mode, setMode] = useState<Mode>("overwrite");
  const [limit, setLimit] = useState("10");
  const [urls, setUrls] = useState("");
  const [recency, setRecency] = useState<Recency>("all");
  const [language, setLanguage] = useState<Language>("zh");
  const SOURCE_OPTIONS =
    platform === "xhs"
      ? SOURCE_OPTIONS_XHS
      : platform === "douyin"
        ? SOURCE_OPTIONS_DOUYIN
        : SOURCE_OPTIONS_YT;
  const itemLabel = platform === "xhs" ? "笔记" : platform === "douyin" ? "作品" : "视频";
  const [error, setError] = useState<string | null>(null);

  const startMutation = trpc.clerk.startAnalysis.useMutation({
    onSuccess: (data) => {
      toast.info(`已开始分析「${channelName}」`);
      onStarted(data);
      setOpen(false);
    },
    onError: (err) => setError(err.message),
  });

  const handleSubmit = () => {
    setError(null);
    const limitNum = Number.parseInt(limit, 10);
    if (source !== "urls") {
      if (!Number.isFinite(limitNum) || limitNum < 1 || limitNum > 50) {
        setError("请输入 1-50 之间的数字");
        return;
      }
    }
    const videoIds =
      source === "urls"
        ? urls
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
        : [];
    if (source === "urls" && videoIds.length === 0) {
      setError(
        platform === "xhs"
          ? "请粘贴至少 1 个小红书笔记 URL"
          : platform === "douyin"
            ? "请粘贴至少 1 个抖音作品 URL"
            : "请粘贴至少 1 个视频 URL",
      );
      return;
    }
    if (source === "urls") {
      const unresolved = videoIds.filter((line) => !lineResolvesToId(line, platform));
      if (unresolved.length > 0) {
        setError(
          `有 ${unresolved.length} 行无法识别为${itemLabel}链接（支持直接粘贴分享文字/链接），请检查后重试`,
        );
        return;
      }
    }
    const recencyMonths =
      recency === "all" ? null : (Number.parseInt(recency, 10) as 1 | 3 | 6);
    startMutation.mutate({
      ...(target.kind === "own"
        ? { channelId: target.channelId }
        : { competitorAccountId: target.competitorAccountId }),
      limit: source === "urls" ? videoIds.length : limitNum,
      mode,
      source,
      videoIds,
      language,
      recencyMonths,
    });
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button size="sm" disabled={disabled} />}>
        <Play data-icon="inline-start" />
        开始分析
      </SheetTrigger>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{target.kind === "competitor" ? "拆解对标账号" : `分析${itemLabel}`}</SheetTitle>
          <SheetDescription>选择{itemLabel}范围和模式，然后开始分析</SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-4">
          {/* Context confirm bar (HCI 防错): restate WHO is being analyzed before launch. */}
          <div
            className={`rounded-md border p-2.5 text-xs ${
              target.kind === "competitor"
                ? "border-muse/40 bg-muse/5"
                : "border-clerk/40 bg-clerk/5"
            }`}
          >
            {target.kind === "competitor" ? (
              <>🎯 你正在拆解【对标账号】<span className="font-medium">{channelName}</span> — 产出的 SOP 进入 SOP 库，可被任意项目选用</>
            ) : (
              <>📺 你正在复盘【我的账号】<span className="font-medium">{channelName}</span></>
            )}
          </div>
          <FieldGroup>
            <Field>
              <FieldLabel>{itemLabel}来源</FieldLabel>
              <div className="flex gap-2">
                {SOURCE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setSource(opt.value)}
                    className={`flex flex-1 flex-col items-start gap-0.5 rounded-md border p-3 text-left text-xs transition-colors ${
                      source === opt.value
                        ? "border-foreground bg-foreground/5"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    <span className="text-sm font-medium">{opt.label}</span>
                    <span className="text-muted-foreground">{opt.hint}</span>
                  </button>
                ))}
              </div>
            </Field>

            {source !== "urls" ? (
              <Field>
                <FieldLabel htmlFor="limit">数量（1-50）</FieldLabel>
                <Input
                  id="limit"
                  type="number"
                  min={1}
                  max={50}
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  推荐 20 个（约 6-10 分钟出 SOP，4 并行）· 预计消耗{" "}
                  {estimateRunMinutes(platform, Number.parseInt(limit, 10) || 0)} 配额分钟
                </p>
              </Field>
            ) : (
              <Field>
                <FieldLabel htmlFor="urls">{itemLabel}链接（每行一个，最多 20 个）</FieldLabel>
                <Textarea
                  id="urls"
                  value={urls}
                  onChange={(e) => setUrls(e.target.value)}
                  placeholder={
                    platform === "xhs"
                      ? "https://www.xiaohongshu.com/explore/...&#10;…"
                      : platform === "douyin"
                        ? "https://www.douyin.com/video/...&#10;https://v.douyin.com/xxxx（分享短链）&#10;…"
                        : "https://www.youtube.com/watch?v=dQw4w9WgXcQ&#10;https://youtu.be/abc123def45&#10;…"
                  }
                  rows={6}
                  className="font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground">
                  {platform === "xhs"
                    ? "支持 xiaohongshu.com/explore · /discovery/item"
                    : platform === "douyin"
                      ? "支持 douyin.com/video · v.douyin.com 短链 · iesdouyin 分享"
                      : "支持 youtube.com/watch · youtu.be · /shorts · /embed"}
                </p>
              </Field>
            )}

            <Field>
              <FieldLabel>分析模式</FieldLabel>
              <div className="flex gap-2">
                {MODE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setMode(opt.value)}
                    className={`flex flex-1 flex-col items-start gap-0.5 rounded-md border p-3 text-left text-xs transition-colors ${
                      mode === opt.value
                        ? "border-foreground bg-foreground/5"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    <span className="text-sm font-medium">{opt.label}</span>
                    <span className="text-muted-foreground">{opt.hint}</span>
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                「从头分析」会重新拆这批视频，不会清空账号已拆的内容；分析后视频累计、SOP 自动刷新。要彻底重来，用上方的「清空重建」。
              </p>
            </Field>

            {(platform === "youtube" || platform === "douyin") && source !== "urls" ? (
              <Field>
                <FieldLabel>时间范围</FieldLabel>
                <div className="flex gap-2">
                  {RECENCY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setRecency(opt.value)}
                      className={`flex-1 rounded-md border p-2 text-xs transition-colors ${
                        recency === opt.value
                          ? "border-foreground bg-foreground/5"
                          : "hover:bg-muted/50"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  只在「近期热门」时影响结果排序范围
                </p>
              </Field>
            ) : null}

            <Field>
              <FieldLabel>SOP 语言</FieldLabel>
              <div className="flex gap-2">
                {LANGUAGE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setLanguage(opt.value)}
                    className={`flex flex-1 flex-col items-start gap-0.5 rounded-md border p-3 text-left text-xs transition-colors ${
                      language === opt.value
                        ? "border-foreground bg-foreground/5"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    <span className="text-sm font-medium">{opt.label}</span>
                    <span className="text-muted-foreground">{opt.hint}</span>
                  </button>
                ))}
              </div>
            </Field>
          </FieldGroup>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <SheetFooter>
          <div className="flex items-center gap-3">
            <Button onClick={handleSubmit} disabled={startMutation.isPending}>
              {startMutation.isPending ? (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              ) : (
                <Play data-icon="inline-start" />
              )}
              {startMutation.isPending ? "启动中…" : "开始分析"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={startMutation.isPending}
            >
              取消
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
