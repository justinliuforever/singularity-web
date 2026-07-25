"use client";

import { Check, Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import type { PoetBible } from "@goooose/db";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { formatDateTime } from "@/lib/datetime";
import { trpc } from "@/lib/trpc";

import { BibleEditSheet } from "./bible-edit-sheet";

type Props = {
  bibles: PoetBible[];
};

// activateBible rejects a bible with open flags; the sibling review card enforces this
// but this button did not, so the only feedback was a server error.
function unresolvedFlags(b: PoetBible): number {
  return (b.importFlags ?? []).filter((f) => !f.resolved).length;
}

export function BibleHistory({ bibles }: Props) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [pendingId, setPendingId] = useState<string | null>(null);

  const activate = trpc.poet.activateBible.useMutation({
    onSuccess: () => {
      toast.success("已切换激活版本");
      // Persistent header bible chip reads channels.context (60s staleTime) — force it.
      void utils.channels.context.invalidate();
      utils.invalidate();
      router.refresh();
    },
    onError: (err) => toast.error(`切换失败：${err.message}`),
    onSettled: () => setPendingId(null),
  });

  const remove = trpc.poet.deleteBible.useMutation({
    onSuccess: () => {
      toast.success("已删除");
      utils.invalidate();
      router.refresh();
    },
    onError: (err) => toast.error(`删除失败：${err.message}`),
    onSettled: () => setPendingId(null),
  });

  if (bibles.length === 0) return null;
  const hasActive = bibles.some((b) => b.isActive);
  // Active version first, then most-recent (page already sorts by updatedAt desc).
  const ordered = [...bibles].sort((a, b) => Number(b.isActive) - Number(a.isActive));
  // Open when the user must pick (no active version) or can switch (multiple versions).
  const defaultOpen = !hasActive || bibles.length > 1;

  return (
    <details
      open={defaultOpen}
      className="flex flex-col gap-3 rounded-lg border bg-card/40 p-4"
    >
      <summary className="flex cursor-pointer items-center justify-between gap-3 list-none [&::-webkit-details-marker]:hidden">
        <span className="text-xs font-medium uppercase text-muted-foreground">
          圣经版本库（{bibles.length}）
        </span>
        <span className="text-xs text-muted-foreground">
          {defaultOpen ? "可点击折叠" : "点击展开"}
        </span>
      </summary>
      <div className="flex flex-col gap-2 border-t pt-3">
        {ordered.map((b) => (
          <div
            key={b.id}
            className="flex items-center justify-between gap-3 rounded-md border bg-background p-3"
          >
            <div className="flex flex-1 flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{b.name}</span>
                {b.isActive ? (
                  <Badge variant="secondary" className="text-[10px]">
                    生效中
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px]">
                    历史版本
                  </Badge>
                )}
              </div>
              <span className="font-mono text-[10px] text-muted-foreground">
                {formatDateTime(b.updatedAt)} · {b.content.length.toLocaleString("en-US")} 字
              </span>
            </div>
            <div className="flex items-center gap-1">
              <BibleEditSheet bibleId={b.id} bibleName={b.name} bibleContent={b.content} />
              {!b.isActive ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pendingId !== null || unresolvedFlags(b) > 0}
                  title={
                    unresolvedFlags(b) > 0
                      ? `还有 ${unresolvedFlags(b)} 个存疑项未确认，确认后才能激活`
                      : undefined
                  }
                  onClick={() => {
                    setPendingId(b.id);
                    activate.mutate({ bibleId: b.id });
                  }}
                >
                  {pendingId === b.id && activate.isPending ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Check className="size-3" />
                  )}
                  激活
                </Button>
              ) : null}
              {!b.isActive ? (
                <ConfirmDialog
                  title={`删除「${b.name}」？`}
                  description="删除后无法恢复。"
                  confirmLabel="删除"
                  disabled={pendingId !== null}
                  onConfirm={() => {
                    setPendingId(b.id);
                    remove.mutate({ bibleId: b.id });
                  }}
                  trigger={
                    <Button size="sm" variant="ghost" disabled={pendingId !== null}>
                      {pendingId === b.id && remove.isPending ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <Trash2 className="size-3" />
                      )}
                    </Button>
                  }
                />
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}
