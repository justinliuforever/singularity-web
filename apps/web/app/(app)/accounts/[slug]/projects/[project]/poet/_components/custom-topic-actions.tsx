"use client";

import { Loader2, PenLine, Sparkles, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { trpc } from "@/lib/trpc";

type Props = {
  channelId: string;
  projectId: string;
  topicId: string;
  topicLabel: string;
  status: "draft" | "analyzed" | "scripted";
  hasActiveBible: boolean;
  hasSop?: boolean;
  // Another poet run holds the account-wide lock; starting would be rejected server-side.
  lockedReason?: string;
};

const DURATIONS = [
  { seconds: 30, label: "30 秒 · 短视频", hint: "≈ 100 字" },
  { seconds: 60, label: "60 秒 · 短视频", hint: "≈ 200 字" },
  { seconds: 180, label: "3 分钟 · 短稿", hint: "≈ 600 字" },
  { seconds: 300, label: "5 分钟 · 短稿", hint: "≈ 1000 字" },
  { seconds: 600, label: "10 分钟 · 长稿", hint: "≈ 2000 字" },
  { seconds: 1200, label: "20 分钟 · 长稿", hint: "≈ 4000 字" },
  { seconds: 1800, label: "30 分钟 · 长稿", hint: "≈ 6000 字" },
] as const;

export function CustomTopicActions({
  channelId,
  projectId,
  topicId,
  topicLabel,
  status,
  hasActiveBible,
  hasSop = true,
  lockedReason,
}: Props) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [pending, setPending] = useState<"analyze" | "script" | "delete" | null>(null);
  const [custom, setCustom] = useState("");

  const analyze = trpc.poet.analyzeCustomTopic.useMutation({
    onSuccess: () => {
      toast.info(`已开始分析「${topicLabel.slice(0, 30)}」`);
      utils.invalidate();
      router.refresh();
    },
    onError: (err) => toast.error(`启动失败：${err.message}`),
    onSettled: () => setPending(null),
  });

  const generate = trpc.poet.generateScriptFromCustomTopic.useMutation({
    onSuccess: () => {
      toast.info(`已开始为「${topicLabel.slice(0, 30)}」写稿`);
      utils.invalidate();
      router.refresh();
    },
    onError: (err) => toast.error(`启动失败：${err.message}`),
    onSettled: () => setPending(null),
  });

  const remove = trpc.poet.deleteCustomTopic.useMutation({
    onSuccess: () => {
      toast.success("已删除");
      utils.invalidate();
      router.refresh();
    },
    onError: (err) => toast.error(`删除失败：${err.message}`),
    onSettled: () => setPending(null),
  });

  const handleAnalyze = () => {
    if (!hasActiveBible) {
      toast.error("请先生成并激活一份频道圣经");
      return;
    }
    setPending("analyze");
    analyze.mutate({ channelId, projectId, topicId, language: "zh" });
  };

  const handleGenerate = (seconds: number) => {
    if (!hasActiveBible) {
      toast.error("请先生成并激活一份频道圣经");
      return;
    }
    if (
      !hasSop &&
      !confirm(
        "该频道还没有 AI 参考 SOP（来自 Clerk 分析），脚本会缺少结构化的钩子 / 留人指导。建议先用 Clerk 生成 SOP。仍要继续写稿吗？",
      )
    ) {
      return;
    }
    setPending("script");
    generate.mutate({ channelId, projectId, topicId, durationSeconds: seconds, language: "zh" });
  };

  const handleGenerateCustom = () => {
    const sec = Math.round(Number(custom));
    if (!Number.isFinite(sec) || sec < 15 || sec > 3600) {
      toast.error("请输入 15–3600 之间的秒数");
      return;
    }
    handleGenerate(sec);
  };

  return (
    <div className="flex items-center gap-2">
      {status === "draft" ? (
        <Button
          size="sm"
          variant="outline"
          onClick={handleAnalyze}
          disabled={pending !== null || !!lockedReason}
        >
          {pending === "analyze" ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Sparkles className="size-3" />
          )}
          分析
        </Button>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button size="sm" variant="outline" disabled={pending !== null || !!lockedReason}>
                {pending === "script" ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <PenLine className="size-3" />
                )}
                写稿
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuLabel>选择视频时长</DropdownMenuLabel>
              {DURATIONS.map((d) => (
                <DropdownMenuItem
                  key={d.seconds}
                  onClick={() => handleGenerate(d.seconds)}
                  disabled={pending !== null || !!lockedReason}
                  className="flex flex-col items-start gap-0.5"
                >
                  <span className="text-sm">{d.label}</span>
                  <span className="text-xs text-muted-foreground">{d.hint}</span>
                </DropdownMenuItem>
              ))}
              <div
                className="px-2 pb-1.5 pt-1"
                onKeyDown={(e) => e.stopPropagation()}
              >
                <div className="mb-1 text-xs text-muted-foreground">自定义（秒，15–3600）</div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={15}
                    max={3600}
                    value={custom}
                    onChange={(e) => setCustom(e.target.value)}
                    placeholder="如 45"
                    className="h-7 w-20 rounded border bg-background px-2 text-sm"
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-7"
                    disabled={pending !== null || !!lockedReason}
                    onClick={handleGenerateCustom}
                  >
                    生成
                  </Button>
                </div>
              </div>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <ConfirmDialog
        title={`删除「${topicLabel.slice(0, 50)}」？`}
        confirmLabel="删除"
        disabled={pending !== null || !!lockedReason}
        onConfirm={() => {
          setPending("delete");
          remove.mutate({ topicId });
        }}
        trigger={
          <Button size="sm" variant="ghost" disabled={pending !== null || !!lockedReason}>
            <Trash2 className="size-3" />
          </Button>
        }
      />
    </div>
  );
}
