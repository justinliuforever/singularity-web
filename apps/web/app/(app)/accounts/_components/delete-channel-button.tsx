"use client";

import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
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

type Props = {
  id: string;
  name: string;
  redirectTo?: string;
};

export function DeleteChannelButton({ id, name, redirectTo }: Props) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const deleteMutation = trpc.channels.delete.useMutation({
    onSuccess: () => {
      utils.channels.list.invalidate();
      toast.success(`已删除「${name}」`);
      if (redirectTo) {
        router.push(redirectTo);
        router.refresh();
      }
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-destructive"
            aria-label={`删除 ${name}`}
          />
        }
      >
        <Trash2 />
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认删除账号？</AlertDialogTitle>
          <AlertDialogDescription>
            <span className="font-mono">{name}</span>{" "}
            及其所有项目、分析记录、SOP、圣经、选题、脚本将被永久删除，无法恢复。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => deleteMutation.mutate({ id })}
            disabled={deleteMutation.isPending}
          >
            删除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
