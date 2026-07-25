"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PenLine, Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
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
  channelSlug?: string;
  ideaId: string;
  ideaTitle: string;
  disabled?: boolean;
  disabledReason?: string;
  hasSop?: boolean;
};

const DURATIONS = [
  { seconds: 30, label: "30 秒 · 短视频", hint: "≈ 100 字" },
  { seconds: 60, label: "60 秒 · 短视频", hint: "≈ 200 字" },
  { seconds: 180, label: "3 分钟 · 短稿", hint: "≈ 600 字" },
  { seconds: 300, label: "5 分钟 · 短稿", hint: "≈ 1000 字，单次写出" },
  { seconds: 600, label: "10 分钟 · 长稿", hint: "≈ 2000 字，大纲→分段" },
  { seconds: 1200, label: "20 分钟 · 长稿", hint: "≈ 4000 字，大纲→分段" },
  { seconds: 1800, label: "30 分钟 · 长稿", hint: "≈ 6000 字，大纲→分段" },
] as const;

export function WriteScriptButton({
  channelId,
  projectId,
  channelSlug,
  ideaId,
  ideaTitle,
  disabled,
  disabledReason,
  hasSop = true,
}: Props) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [pending, setPending] = useState(false);
  const [custom, setCustom] = useState("");
  const [pendingSeconds, setPendingSeconds] = useState<number | null>(null);

  const mutation = trpc.poet.generateScript.useMutation({
    onSuccess: () => {
      toast.info(`已开始为「${ideaTitle.slice(0, 30)}」写稿`);
      utils.invalidate();
      router.refresh();
    },
    onError: (err) => toast.error(`启动失败：${err.message}`),
    onSettled: () => setPending(false),
  });

  // base-nova's DropdownMenuTrigger doesn't propagate `disabled` to the menu open state.
  if (disabled) {
    return (
      <Button
        size="sm"
        variant="outline"
        disabled
        title={disabledReason}
        onClick={() => disabledReason && toast.error(disabledReason)}
      >
        <PenLine className="size-3" />
        写稿
      </Button>
    );
  }

  const startRun = (seconds: number) => {
    setPending(true);
    mutation.mutate({ channelId, projectId, ideaId, durationSeconds: seconds, language: "zh" });
  };

  const handlePick = (seconds: number) => {
    if (!hasSop) {
      setPendingSeconds(seconds);
      return;
    }
    startRun(seconds);
  };

  const handlePickCustom = () => {
    const sec = Math.round(Number(custom));
    if (!Number.isFinite(sec) || sec < 15 || sec > 3600) {
      toast.error("请输入 15–3600 之间的秒数");
      return;
    }
    handlePick(sec);
  };

  return (
    <>
      <AlertDialog
        open={pendingSeconds !== null}
        onOpenChange={(open) => {
          if (!open) setPendingSeconds(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>该频道还没有 AI 参考 SOP</AlertDialogTitle>
            <AlertDialogDescription>
              SOP 来自 Clerk 分析，缺少它脚本会少了结构化的钩子 / 留人指导。建议先用 Clerk
              生成 SOP，再回来写稿。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            {channelSlug ? (
              <Button
                variant="outline"
                render={<Link href={`/clerk/${encodeURIComponent(channelSlug)}`} />}
              >
                去 Clerk 分析
              </Button>
            ) : null}
            <AlertDialogAction
              onClick={() => {
                const s = pendingSeconds;
                setPendingSeconds(null);
                if (s !== null) startRun(s);
              }}
            >
              仍要写稿
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button size="sm" variant="outline" disabled={pending}>
            {pending ? <Loader2 className="size-3 animate-spin" /> : <PenLine className="size-3" />}
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
              onClick={() => handlePick(d.seconds)}
              disabled={pending}
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
                disabled={pending}
                onClick={handlePickCustom}
              >
                生成
              </Button>
            </div>
          </div>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
    </>
  );
}
