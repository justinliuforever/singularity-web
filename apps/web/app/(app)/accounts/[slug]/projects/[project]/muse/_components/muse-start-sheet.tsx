"use client";

import { Check, Loader2, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { CompetitorAvatar } from "@/components/competitor-avatar";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cleanProfileName } from "@/lib/display-name";
import { followerNoun, formatFollowerCount } from "@/lib/format-count";
import { PLATFORM_LABEL } from "@/lib/platform";
import { trpc } from "@/lib/trpc";

type Language = "zh" | "en";
type ContentFilter = "all" | "video" | "image";

export type MuseCompetitor = {
  id: string;
  name: string | null;
  url: string;
  platform: "youtube" | "xhs" | "douyin";
  avatarUrl: string | null;
  subscriberCount: number | null;
};

type Props = {
  channelId: string;
  projectId: string;
  channelName: string;
  competitors: MuseCompetitor[];
  disabled: boolean;
};

const VIDEOS_PER_COMPETITOR = [5, 10, 20, 50] as const;
const IDEAS_PER_VIDEO = [3, 5, 10] as const;

const LANGUAGE_OPTIONS: Array<{ value: Language; label: string; hint: string }> = [
  { value: "zh", label: "中文选题", hint: "适合中文目标频道" },
  { value: "en", label: "English ideas", hint: "适合英文目标频道" },
];

const CONTENT_FILTER_OPTIONS: Array<{ value: ContentFilter; label: string; hint: string }> = [
  { value: "all", label: "全部内容", hint: "视频 + 图文" },
  { value: "video", label: "仅视频", hint: "音频转写后分析" },
  { value: "image", label: "仅图文", hint: "标题 + 正文分析" },
];

export function MuseStartSheet({ channelId, projectId, channelName, competitors, disabled }: Props) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [maxVideos, setMaxVideos] = useState<(typeof VIDEOS_PER_COMPETITOR)[number]>(10);
  const [numIdeas, setNumIdeas] = useState<(typeof IDEAS_PER_VIDEO)[number]>(5);
  const [language, setLanguage] = useState<Language>("zh");
  const [contentFilter, setContentFilter] = useState<ContentFilter>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(competitors.map((c) => c.id)),
  );
  const [extraIds, setExtraIds] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);

  // Only load the user's competitor pool once the sheet is opened.
  const allCompetitors = trpc.competitors.list.useQuery(undefined, { enabled: open });
  const boundIdSet = useMemo(() => new Set(competitors.map((c) => c.id)), [competitors]);
  const unbound = useMemo(
    () => (allCompetitors.data ?? []).filter((c) => !boundIdSet.has(c.id)),
    [allCompetitors.data, boundIdSet],
  );

  const selected = useMemo(
    () => competitors.filter((c) => selectedIds.has(c.id)),
    [competitors, selectedIds],
  );
  const extraSelected = useMemo(
    () => unbound.filter((c) => extraIds.has(c.id)),
    [unbound, extraIds],
  );
  const hasXhs =
    selected.some((c) => c.platform === "xhs") || extraSelected.some((c) => c.platform === "xhs");
  const hasYt =
    selected.some((c) => c.platform === "youtube") ||
    extraSelected.some((c) => c.platform === "youtube");
  const hasDouyin =
    selected.some((c) => c.platform === "douyin") ||
    extraSelected.some((c) => c.platform === "douyin");

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleExtra = (id: string) => {
    setExtraIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const startMutation = trpc.muse.startMonitor.useMutation({
    onSuccess: () => {
      toast.info(`已开始巡视「${channelName}」的对标账号`);
      setOpen(false);
      // Re-fetch the server `activeRun` so the progress panel shows without a manual refresh.
      utils.invalidate();
      router.refresh();
    },
    onError: (err) => setError(err.message),
  });

  const handleSubmit = () => {
    setError(null);
    const allSelected = selected.length === competitors.length;
    startMutation.mutate({
      channelId,
      projectId,
      maxVideosPerCompetitor: maxVideos,
      numIdeasPerVideo: numIdeas,
      language,
      ...(allSelected ? {} : { competitorAccountIds: selected.map((c) => c.id) }),
      ...(extraSelected.length > 0
        ? { extraCompetitorAccountIds: extraSelected.map((c) => c.id) }
        : {}),
      contentFilter,
    });
  };

  const totalCount = selected.length + extraSelected.length;
  const totalIdeas = totalCount * maxVideos * numIdeas;
  const contentNoun = (() => {
    const parts: string[] = [];
    if (hasYt) parts.push("YouTube 视频");
    if (hasXhs) parts.push("小红书笔记");
    if (hasDouyin) parts.push("抖音作品");
    if (parts.length === 0) return "最新内容";
    if (parts.length === 1) return `最新${parts[0]}`;
    return `最新内容（${parts.join(" + ")}）`;
  })();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button size="sm" disabled={disabled} />}>
        <Play data-icon="inline-start" />
        开始巡视
      </SheetTrigger>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>巡视对标账号</SheetTitle>
          <SheetDescription>
            灵感小鹅会扫描下面所选对标账号的{contentNoun}，提取爆款机制，为「{channelName}」生成选题。
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-4">
          <FieldGroup>
            <Field>
              <FieldLabel>巡视哪些对标账号</FieldLabel>
              <div className="flex flex-col gap-1.5">
                {competitors.map((c) => {
                  const isOn = selectedIds.has(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggle(c.id)}
                      className={`flex items-center gap-2.5 rounded-md border p-2 text-left text-xs transition-colors ${
                        isOn ? "border-foreground bg-foreground/5" : "opacity-60 hover:bg-muted/50"
                      }`}
                    >
                      <CompetitorAvatar name={c.name} avatarUrl={c.avatarUrl} className="size-7" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate font-medium">
                          {c.name ? cleanProfileName(c.name) : c.url}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {PLATFORM_LABEL[c.platform]}
                          {c.subscriberCount != null
                            ? ` · ${formatFollowerCount(c.subscriberCount)} ${followerNoun(c.platform)}`
                            : ""}
                        </span>
                      </span>
                      <span
                        className={`flex size-4 shrink-0 items-center justify-center rounded border ${
                          isOn ? "border-foreground bg-foreground text-background" : "border-border"
                        }`}
                      >
                        {isOn ? <Check className="size-3" /> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
              {totalCount === 0 ? (
                <p className="text-xs text-destructive">至少选择一个对标账号</p>
              ) : null}
            </Field>

            {unbound.length > 0 ? (
              <Field>
                <FieldLabel>临时加入其他对标（仅本次）</FieldLabel>
                <div className="flex flex-col gap-1.5">
                  {unbound.map((c) => {
                    const isOn = extraIds.has(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => toggleExtra(c.id)}
                        className={`flex items-center gap-2.5 rounded-md border p-2 text-left text-xs transition-colors ${
                          isOn ? "border-foreground bg-foreground/5" : "opacity-60 hover:bg-muted/50"
                        }`}
                      >
                        <CompetitorAvatar name={c.name} avatarUrl={c.avatarUrl} className="size-7" />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate font-medium">
                          {c.name ? cleanProfileName(c.name) : c.url}
                        </span>
                          <span className="text-[10px] text-muted-foreground">
                            {PLATFORM_LABEL[c.platform]}
                            {c.subscriberCount != null
                              ? ` · ${formatFollowerCount(c.subscriberCount)} ${followerNoun(c.platform)}`
                              : ""}
                          </span>
                        </span>
                        <span
                          className={`flex size-4 shrink-0 items-center justify-center rounded border ${
                            isOn ? "border-foreground bg-foreground text-background" : "border-border"
                          }`}
                        >
                          {isOn ? <Check className="size-3" /> : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  仅本次巡视加入，不会绑定到项目
                </p>
              </Field>
            ) : null}

            <Field>
              <FieldLabel>每个对标账号拉取内容数</FieldLabel>
              <div className="flex gap-2">
                {VIDEOS_PER_COMPETITOR.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setMaxVideos(n)}
                    className={`flex-1 rounded-md border p-2 font-mono text-xs transition-colors ${
                      maxVideos === n
                        ? "border-foreground bg-foreground/5"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                推荐 10 个；视频每条约 30-90s 处理，图文更快
              </p>
            </Field>

            {hasXhs || hasDouyin ? (
              <Field>
                <FieldLabel>内容类型</FieldLabel>
                <div className="flex gap-2">
                  {CONTENT_FILTER_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setContentFilter(opt.value)}
                      className={`flex flex-1 flex-col items-start gap-0.5 rounded-md border p-2 text-left text-xs transition-colors ${
                        contentFilter === opt.value
                          ? "border-foreground bg-foreground/5"
                          : "hover:bg-muted/50"
                      }`}
                    >
                      <span className="font-medium">{opt.label}</span>
                      <span className="text-[10px] text-muted-foreground">{opt.hint}</span>
                    </button>
                  ))}
                </div>
              </Field>
            ) : null}

            <Field>
              <FieldLabel>每个相关视频生成选题数</FieldLabel>
              <div className="flex gap-2">
                {IDEAS_PER_VIDEO.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setNumIdeas(n)}
                    className={`flex-1 rounded-md border p-2 font-mono text-xs transition-colors ${
                      numIdeas === n
                        ? "border-foreground bg-foreground/5"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                每个被判定「有借鉴价值」的视频会生成这么多选题
              </p>
            </Field>

            <Field>
              <FieldLabel>选题语言</FieldLabel>
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
              <p className="text-xs text-muted-foreground">
                对标无论中文还是英文，分析按各自源语言进行；选题统一用这个语言生成。
              </p>
            </Field>

            <div className="rounded-md border bg-muted/30 p-3 text-xs">
              <span className="font-medium text-foreground">预估上限：</span>
              <span className="font-mono">
                {totalCount} × {maxVideos} × {numIdeas} = 最多 {totalIdeas.toLocaleString()} 选题
              </span>
              <p className="mt-1 text-muted-foreground">
                实际产出取决于相关性筛选 — 只有与你频道定位相关、且有可借鉴爆款机制的内容才会生成选题。
              </p>
            </div>
          </FieldGroup>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <SheetFooter>
          <div className="flex items-center gap-3">
            <Button
              onClick={handleSubmit}
              disabled={startMutation.isPending || totalCount === 0}
            >
              {startMutation.isPending ? (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              ) : (
                <Play data-icon="inline-start" />
              )}
              {startMutation.isPending ? "启动中…" : `巡视 ${totalCount} 个对标`}
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
