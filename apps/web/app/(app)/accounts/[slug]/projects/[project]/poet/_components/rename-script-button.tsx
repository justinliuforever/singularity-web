"use client";

import { Loader2, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
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
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";

type Props = {
  scriptId: string;
  currentName: string;
};

export function RenameScriptButton({ scriptId, currentName }: Props) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(currentName);

  const rename = trpc.poet.renameScript.useMutation({
    onSuccess: () => {
      toast.success("已重命名脚本");
      setOpen(false);
      utils.invalidate();
      router.refresh();
    },
    onError: (err) => toast.error(`重命名失败：${err.message}`),
  });

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("名字不能为空");
      return;
    }
    rename.mutate({ scriptId, name: trimmed.slice(0, 120) });
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) setName(currentName);
      }}
    >
      <AlertDialogTrigger
        render={
          <Button size="sm" variant="ghost" onClick={(e) => e.stopPropagation()} aria-label="重命名脚本" />
        }
      >
        {rename.isPending ? <Loader2 className="size-3 animate-spin" /> : <Pencil className="size-3" />}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>重命名脚本</AlertDialogTitle>
          <AlertDialogDescription>列表和脚本详情页都会显示这个名字。</AlertDialogDescription>
        </AlertDialogHeader>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="给这篇脚本起个名字"
          maxLength={120}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
        />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={rename.isPending}>取消</AlertDialogCancel>
          <AlertDialogAction onClick={submit} disabled={rename.isPending || !name.trim()}>
            保存
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
