"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, FileText } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { formatDate } from "@/lib/datetime";
import { trpc } from "@/lib/trpc";

export type CurrentSop = {
  sourceName: string;
  generatedAt: Date | string | null;
  // false = no explicit binding; the writer falls back to this account's latest SOP.
  pinned: boolean;
  sourceKind: "own" | "competitor";
} | null;

export function ProjectSopRow({
  projectId,
  current,
}: {
  projectId: string;
  current: CurrentSop;
}) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);

  const picker = trpc.sops.pickerList.useQuery({ projectId }, { enabled: open });

  const setPrimary = trpc.sops.setPrimary.useMutation({
    onError: (e) => toast.error(e.message),
  });

  const choose = (sopId: string, sourceName: string) => {
    const prev = picker.data?.find((r) => r.isCurrent);
    setPrimary.mutate(
      { projectId, sopId },
      {
        onSuccess: () => {
          utils.sops.pickerList.invalidate({ projectId });
          router.refresh();
          setOpen(false);
          toast.success(`已选用「${sourceName}」的 SOP`, {
            action:
              prev && prev.id !== sopId
                ? {
                    label: "撤销",
                    onClick: () =>
                      setPrimary.mutate(
                        { projectId, sopId: prev.id },
                        {
                          onSuccess: () => {
                            utils.sops.pickerList.invalidate({ projectId });
                            router.refresh();
                            toast.success(`已恢复「${prev.sourceName}」的 SOP`);
                          },
                        },
                      ),
                  }
                : undefined,
          });
        },
      },
    );
  };

  const buildGroups = (kind: "own" | "competitor") => {
    const groups = new Map<string, NonNullable<typeof picker.data>>();
    for (const row of picker.data ?? []) {
      if (row.sourceKind !== kind) continue;
      const list = groups.get(row.sourceName) ?? [];
      list.push(row);
      groups.set(row.sourceName, list);
    }
    return [...groups.entries()];
  };
  const sections: Array<{ label: string; groups: ReturnType<typeof buildGroups> }> = [
    { label: "🎯 来自对标账号", groups: buildGroups("competitor") },
    { label: "📺 来自我的账号", groups: buildGroups("own") },
  ].filter((s) => s.groups.length > 0);

  return (
    <div className="flex items-center gap-2.5 rounded-lg border bg-card/50 px-4 py-2.5 text-sm">
      <FileText className="size-4 shrink-0 text-clerk-deep" />
      {current ? (
        <span className="min-w-0 truncate">
          <span className="text-muted-foreground">写稿 SOP：</span>
          <span className="font-medium">
            {current.sourceKind === "competitor" ? "🎯 来自对标" : "来自"}「{current.sourceName}」
          </span>
          {current.generatedAt ? (
            <span className="text-xs text-muted-foreground"> · {formatDate(current.generatedAt)} 生成</span>
          ) : null}
          {!current.pinned ? (
            <span className="text-xs text-muted-foreground">（默认使用本账号最新 SOP）</span>
          ) : null}
        </span>
      ) : (
        <span className="min-w-0 truncate text-muted-foreground">
          还没有可用的写稿 SOP — 先用操盘小鹅拆解生成，或从其他账号选用
        </span>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger render={<Button variant="outline" size="sm" className="ml-auto shrink-0" />}>
          {current ? "更换" : "选用"}
        </SheetTrigger>
        <SheetContent className="flex w-full flex-col gap-0 sm:max-w-md">
          <SheetHeader>
            <SheetTitle>选用写稿 SOP</SheetTitle>
            <SheetDescription>
              SOP 是操盘小鹅从频道拆解出的可复用写稿方法论。任何账号拆出的 SOP 都可以选用到这个项目。
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
            {picker.isLoading ? (
              <p className="text-xs text-muted-foreground">加载中…</p>
            ) : (picker.data ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">
                还没有任何可选 SOP — 先去操盘小鹅拆解一个频道。
              </p>
            ) : (
              sections.map((section) => (
                <div key={section.label} className="flex flex-col gap-2">
                  <p className="text-xs font-semibold">{section.label}</p>
                  {section.groups.map(([sourceName, rows]) => (
                <div key={sourceName} className="flex flex-col gap-1.5">
                  <p className="text-xs font-medium text-muted-foreground">「{sourceName}」</p>
                  {rows.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      disabled={setPrimary.isPending || r.isCurrent}
                      onClick={() => choose(r.id, r.sourceName)}
                      className={`flex items-center gap-2.5 rounded-md border p-2.5 text-left text-xs transition-colors ${
                        r.isCurrent
                          ? "border-poet bg-poet/5"
                          : "hover:bg-muted/50"
                      }`}
                    >
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="font-medium">
                          {formatDate(r.generatedAt)} 生成
                          <span className="ml-1.5 font-mono text-[10px] text-muted-foreground uppercase">
                            {r.language}
                          </span>
                        </span>
                        {r.usedBy > 0 ? (
                          <span className="text-[10px] text-muted-foreground">
                            已用于 {r.usedBy} 个项目
                          </span>
                        ) : null}
                      </span>
                      {r.isCurrent ? (
                        <Badge variant="success" className="shrink-0 text-[10px]">
                          <Check className="size-3" />
                          当前生效
                        </Badge>
                      ) : (
                        <span className="shrink-0 text-[10px] text-muted-foreground">选用</span>
                      )}
                    </button>
                  ))}
                </div>
                  ))}
                </div>
              ))
            )}
          </div>

          <SheetFooter className="mt-auto">
            <p className="text-xs leading-relaxed text-muted-foreground">
              选用后，这个项目之后用神笔小鹅写稿都会按这份 SOP 的结构和风格来。已写好的稿不受影响。
            </p>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
