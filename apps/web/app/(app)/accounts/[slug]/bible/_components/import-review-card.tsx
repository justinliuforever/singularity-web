"use client";

import { AlertTriangle, Check, CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import type { ImportFlag } from "@goooose/db";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

const FLAG_LABEL: Record<ImportFlag["type"], string> = {
  illegible: "无法辨识",
  truncated: "内容截断",
  audit: "数字审计",
  image_failed: "图表转写失败",
};

const FLAG_HINT: Record<ImportFlag["type"], string> = {
  illegible: "原文件中该处模糊或被裁切。请对照原文件，用「编辑」把缺失内容补进圣经，或确认可以忽略。",
  truncated: "部分内容在原文件中就不完整。建议向文档提供方索取完整版后补充，或确认现有内容已够用。",
  audit: "这些数字未能在文档转写中找到出处，相关行已被移除。如原文件确有这些数字，请用「编辑」补回。",
  image_failed: "个别图表未能转写。请对照原文件把关键数据用「编辑」补进圣经，或确认可以忽略。",
};

type Props = {
  bibleId: string;
  bibleName: string;
  flags: ImportFlag[];
};

// An imported bible stays inactive until every flag is confirmed; activateBible enforces
// the same gate server-side.
export function ImportReviewCard({ bibleId, bibleName, flags }: Props) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [resolving, setResolving] = useState<number | null>(null);

  const resolve = trpc.poet.resolveImportFlag.useMutation({
    onSuccess: ({ remaining }) => {
      if (remaining === 0) toast.success("全部存疑项已确认，现在可以激活这份圣经了");
      utils.invalidate();
      router.refresh();
    },
    onError: (err) => toast.error(err.message),
    onSettled: () => setResolving(null),
  });

  const activate = trpc.poet.activateBible.useMutation({
    onSuccess: () => {
      toast.success("圣经已激活");
      void utils.channels.context.invalidate();
      utils.invalidate();
      router.refresh();
    },
    onError: (err) => toast.error(err.message),
  });

  const unresolved = flags.filter((f) => !f.resolved).length;

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-5">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-4 text-amber-600" />
          <h3 className="text-sm font-medium">
            「{bibleName}」导入存疑项确认（{flags.length - unresolved}/{flags.length}）
          </h3>
        </div>
        <Button
          size="sm"
          disabled={unresolved > 0 || activate.isPending}
          onClick={() => activate.mutate({ bibleId })}
        >
          {activate.isPending ? "激活中…" : unresolved > 0 ? `还剩 ${unresolved} 项` : "激活这份圣经"}
        </Button>
      </header>
      <p className="text-xs text-muted-foreground">
        逐项核对后点「确认」。需要修改内容时，在下方「历史版本」里用「编辑」修正。全部确认后才能激活。
      </p>
      <ul className="flex flex-col gap-2">
        {flags.map((flag, i) => (
          <li
            key={i}
            className={`flex items-start justify-between gap-3 rounded-md border p-3 text-sm ${
              flag.resolved ? "border-border bg-card/50 opacity-60" : "border-amber-500/30 bg-card"
            }`}
          >
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-[10px]">
                  {FLAG_LABEL[flag.type] ?? flag.type}
                </Badge>
                {flag.resolved ? (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <CheckCircle2 className="size-3" /> 已确认
                  </span>
                ) : null}
              </div>
              <span className="break-words">{flag.detail}</span>
              {!flag.resolved ? (
                <span className="text-xs text-muted-foreground">{FLAG_HINT[flag.type]}</span>
              ) : null}
            </div>
            {!flag.resolved ? (
              <Button
                size="sm"
                variant="outline"
                className="shrink-0"
                disabled={resolving === i}
                onClick={() => {
                  setResolving(i);
                  resolve.mutate({ bibleId, flagIndex: i });
                }}
              >
                <Check className="size-3" data-icon="inline-start" />
                {resolving === i ? "确认中…" : "确认"}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
