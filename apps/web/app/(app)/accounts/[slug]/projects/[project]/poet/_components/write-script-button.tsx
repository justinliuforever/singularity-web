"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { trpc } from "@/lib/trpc";

import { WriteScriptSheet } from "./write-script-sheet";

type Props = {
  channelId: string;
  projectId: string;
  channelSlug?: string;
  ideaId: string;
  ideaTitle: string;
  disabled?: boolean;
  disabledReason?: string;
};

export function WriteScriptButton({
  channelId,
  projectId,
  channelSlug,
  ideaId,
  ideaTitle,
  disabled,
  disabledReason,
}: Props) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [pending, setPending] = useState(false);

  const mutation = trpc.poet.generateScript.useMutation({
    onSuccess: () => {
      toast.info(`已开始为「${ideaTitle.slice(0, 30)}」写稿`);
      utils.invalidate();
      router.refresh();
    },
    onError: (err) => toast.error(`启动失败：${err.message}`),
    onSettled: () => setPending(false),
  });

  return (
    <WriteScriptSheet
      channelId={channelId}
      projectId={projectId}
      channelSlug={channelSlug}
      topicLabel={ideaTitle}
      pending={pending}
      disabled={disabled}
      disabledReason={disabledReason}
      onSubmit={(durationSeconds, sopId) => {
        setPending(true);
        mutation.mutate({
          channelId,
          projectId,
          ideaId,
          durationSeconds,
          language: "zh",
          ...(sopId ? { sopId } : {}),
        });
      }}
    />
  );
}
