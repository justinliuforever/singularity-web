"use client";

import { useRouter } from "next/navigation";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

// The server guard refuses any account that already has bible/script/topic/idea content.
export function ConvertToCompetitorButton({
  channelId,
  channelName,
}: {
  channelId: string;
  channelName: string;
}) {
  const router = useRouter();
  const convert = trpc.channelsMaintenance.convertToCompetitor.useMutation({
    onSuccess: (res) => {
      toast.success(`「${channelName}」已转为对标账号`);
      router.push(`/clerk/competitor/${res.competitorAccountId}`);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={<Button variant="ghost" size="sm" className="text-xs text-muted-foreground" />}
      >
        这其实是学习对象？转为对标
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>把「{channelName}」转为对标账号？</AlertDialogTitle>
          <AlertDialogDescription>
            已拆解的视频和 SOP 会跟着搬到对标账号下（SOP 引用不受影响）；这个账号和它的项目会从「我的账号」里移除。仅适用于纯学习对象 —
            有圣经、脚本或选题的账号会被拒绝转换。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => convert.mutate({ channelId })}
            disabled={convert.isPending}
          >
            {convert.isPending ? "转换中…" : "确认转换"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
