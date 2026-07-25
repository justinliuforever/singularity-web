"use client";

import { Loader2, ScanLine } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useRealtimeRun } from "@trigger.dev/react-hooks";

import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

type ActiveRun = { runId: string; triggerRunId: string; publicAccessToken: string };

const TERMINAL = ["FAILED", "CANCELED", "CRASHED", "SYSTEM_FAILURE", "TIMED_OUT", "EXPIRED"];

export function SingleVideoSopButton({
  videoId,
  hasTranscript,
  isImagePost = false,
  blockedReason,
  language = "zh",
}: {
  videoId: string;
  hasTranscript: boolean;
  isImagePost?: boolean;
  blockedReason?: string;
  language?: "zh" | "en";
}) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [active, setActive] = useState<ActiveRun | null>(null);

  const generate = trpc.clerk.generateVideoSop.useMutation({
    onSuccess: (run) => setActive(run),
    onError: (err) => toast.error(err.message),
  });

  if (!hasTranscript) {
    return (
      <Button
        size="sm"
        variant="ghost"
        disabled
        title={isImagePost ? "这条图文没有正文内容，无法拆解" : "该视频没有字幕/转写，无法生成单条拆解"}
      >
        {isImagePost ? "无正文" : "无字幕"}
      </Button>
    );
  }

  const running = generate.isPending || active != null;

  // The server lock is agent-wide, so any clerk run rejects this — mirror it here rather
  // than rendering an enabled button the table repaints every 5s during an analysis. Checked
  // after `running` so this row's own in-flight watcher is never unmounted mid-run.
  if (blockedReason && !running) {
    return (
      <Button size="sm" variant="ghost" disabled title={blockedReason}>
        <ScanLine data-icon="inline-start" />
        单条拆解
      </Button>
    );
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={running}
        onClick={() => generate.mutate({ videoId, language })}
      >
        {running ? (
          <Loader2 data-icon="inline-start" className="animate-spin" />
        ) : (
          <ScanLine data-icon="inline-start" />
        )}
        {running ? "生成中…" : "单条拆解"}
      </Button>
      {active ? (
        <SingleVideoWatcher
          triggerRunId={active.triggerRunId}
          accessToken={active.publicAccessToken}
          onSettled={(ok, message) => {
            setActive(null);
            if (ok) {
              toast.success("单条拆解 SOP 已生成");
              utils.invalidate();
              router.refresh();
            } else {
              toast.error(message ?? "生成失败");
            }
          }}
        />
      ) : null}
    </>
  );
}

function SingleVideoWatcher({
  triggerRunId,
  accessToken,
  onSettled,
}: {
  triggerRunId: string;
  accessToken: string;
  onSettled: (ok: boolean, message?: string) => void;
}) {
  const { run, error } = useRealtimeRun(triggerRunId, { accessToken, throttleInMs: 1000 });
  const settledRef = useRef(false);
  useEffect(() => {
    if (settledRef.current) return;
    if (error) {
      settledRef.current = true;
      onSettled(false, `错误：${error.message}`);
      return;
    }
    if (!run) return;
    if (run.status === "COMPLETED") {
      settledRef.current = true;
      onSettled(true);
    } else if (TERMINAL.includes(run.status)) {
      settledRef.current = true;
      onSettled(false, run.error?.message);
    }
  }, [run, error, onSettled]);
  return null;
}
