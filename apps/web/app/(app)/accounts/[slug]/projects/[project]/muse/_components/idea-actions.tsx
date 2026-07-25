"use client";

import { Check, X, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

type IdeaState = "pending" | "adopted" | "dismissed" | "scripted";

type Props = {
  ideaId: string;
  state: IdeaState;
  accountSlug: string;
  projectSlug: string;
};

export function IdeaActions({ ideaId, state, accountSlug, projectSlug }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const approveIdea = trpc.muse.approveIdea.useMutation({
    onSuccess: () => router.refresh(),
    onError: (err) => toast.error(`保存失败：${err.message}`),
    onSettled: () => setPending(false),
  });
  const dismissIdea = trpc.muse.dismissIdea.useMutation({
    onSuccess: () => router.refresh(),
    onError: (err) => toast.error(`保存失败：${err.message}`),
    onSettled: () => setPending(false),
  });

  const adopt = () => {
    setPending(true);
    approveIdea.mutate(
      { ideaId, approved: true },
      {
        onSuccess: () =>
          toast.success("已加入神笔小鹅待写", {
            action: { label: "撤销", onClick: () => approveIdea.mutate({ ideaId, approved: false }) },
          }),
      },
    );
  };
  const dismiss = () => {
    setPending(true);
    dismissIdea.mutate(
      { ideaId, dismissed: true },
      {
        onSuccess: () =>
          toast.success("已忽略", {
            action: { label: "撤销", onClick: () => dismissIdea.mutate({ ideaId, dismissed: false }) },
          }),
      },
    );
  };

  if (state === "scripted") {
    return <span className="text-[10px] text-muted-foreground">已写稿</span>;
  }

  if (state === "adopted") {
    return (
      <div className="flex shrink-0 items-center gap-2">
        <Badge variant="secondary" className="text-[10px]">
          已采用
        </Badge>
        <Button
          size="sm"
          variant="ghost"
          render={
            <Link
              href={`/accounts/${encodeURIComponent(accountSlug)}/projects/${encodeURIComponent(projectSlug)}/poet`}
            />
          }
        >
          去神笔小鹅写稿
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground"
          disabled={pending}
          onClick={() => {
            setPending(true);
            approveIdea.mutate({ ideaId, approved: false });
          }}
        >
          取消采用
        </Button>
      </div>
    );
  }

  if (state === "dismissed") {
    return (
      <Button
        size="sm"
        variant="ghost"
        className="text-muted-foreground"
        disabled={pending}
        onClick={() => {
          setPending(true);
          dismissIdea.mutate({ ideaId, dismissed: false });
        }}
      >
        撤销
      </Button>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <Button size="sm" disabled={pending} onClick={adopt}>
        {pending ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Check data-icon="inline-start" />}
        采用 → 神笔小鹅
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="text-muted-foreground"
        disabled={pending}
        onClick={dismiss}
      >
        <X data-icon="inline-start" />
        忽略
      </Button>
    </div>
  );
}
