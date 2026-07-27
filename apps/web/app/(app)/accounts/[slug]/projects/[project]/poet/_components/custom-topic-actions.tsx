"use client";

import { Loader2, Sparkles, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { trpc } from "@/lib/trpc";

import { WriteScriptSheet } from "./write-script-sheet";

type Props = {
  channelId: string;
  projectId: string;
  channelSlug?: string;
  topicId: string;
  topicLabel: string;
  status: "draft" | "analyzed" | "scripted";
  hasActiveBible: boolean;
};

export function CustomTopicActions({
  channelId,
  projectId,
  channelSlug,
  topicId,
  topicLabel,
  status,
  hasActiveBible,
}: Props) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [pending, setPending] = useState<"analyze" | "script" | "delete" | null>(null);

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

  return (
    <div className="flex items-center gap-2">
      {status === "draft" ? (
        <Button
          size="sm"
          variant="outline"
          onClick={handleAnalyze}
          disabled={pending !== null}
        >
          {pending === "analyze" ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Sparkles className="size-3" />
          )}
          分析
        </Button>
      ) : (
        <WriteScriptSheet
          channelId={channelId}
          projectId={projectId}
          channelSlug={channelSlug}
          topicLabel={topicLabel}
          pending={pending === "script"}
          disabled={!hasActiveBible}
          disabledReason={!hasActiveBible ? "请先生成并激活一份频道圣经" : undefined}
          onSubmit={(durationSeconds, sopId) => {
            setPending("script");
            generate.mutate({
              channelId,
              projectId,
              topicId,
              durationSeconds,
              language: "zh",
              ...(sopId ? { sopId } : {}),
            });
          }}
        />
      )}
      <ConfirmDialog
        title={`删除「${topicLabel.slice(0, 50)}」？`}
        confirmLabel="删除"
        disabled={pending !== null}
        onConfirm={() => {
          setPending("delete");
          remove.mutate({ topicId });
        }}
        trigger={
          <Button size="sm" variant="ghost" disabled={pending !== null}>
            <Trash2 className="size-3" />
          </Button>
        }
      />
    </div>
  );
}
