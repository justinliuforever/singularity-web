"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { CompetitorAvatar } from "@/components/competitor-avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { followerNoun, formatFollowerCount } from "@/lib/format-count";
import { inferPlatform, isValidPlatformUrl, PLATFORM_LABEL } from "@/lib/platform";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";

// project.id == channel.id during the expand phase, so the channel page passes channel.id.
export function ProjectCompetitorsCard({
  projectId,
  accountSlug,
  projectSlug,
}: {
  projectId: string;
  accountSlug?: string;
  projectSlug?: string;
}) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const bound = trpc.competitors.listForProject.useQuery({ projectId });
  const pool = trpc.competitors.list.useQuery();

  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");

  const boundIds = useMemo(() => new Set((bound.data ?? []).map((c) => c.id)), [bound.data]);

  const museHref =
    accountSlug && projectSlug
      ? `/accounts/${encodeURIComponent(accountSlug)}/projects/${encodeURIComponent(projectSlug)}/muse`
      : null;
  const toastBound = (message: string) => {
    if (museHref) {
      toast.success(message, {
        action: { label: "去灵感小鹅巡视", onClick: () => router.push(museHref) },
      });
    } else {
      toast.success(message);
    }
  };

  const invalidate = () => {
    utils.competitors.listForProject.invalidate({ projectId });
    utils.competitors.list.invalidate();
    router.refresh();
  };
  const bindM = trpc.competitors.bind.useMutation({
    onSuccess: () => {
      invalidate();
      toastBound("已绑定对标账号");
    },
    onError: (e) => toast.error(e.message),
  });
  const unbindM = trpc.competitors.unbind.useMutation({ onSuccess: invalidate, onError: (e) => toast.error(e.message) });
  const importM = trpc.competitors.import.useMutation({
    onSuccess: (data) => {
      invalidate();
      const n = data.results.filter((r) => r.id).length;
      toastBound(`已导入并绑定 ${n} 个对标账号`);
      setText("");
    },
    onError: (e) => toast.error(e.message),
  });

  const parsed = useMemo(
    () =>
      text
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map((url) => {
          const platform = inferPlatform(url);
          return { url, platform, ok: isValidPlatformUrl(platform, url) };
        }),
    [text],
  );
  const validCount = parsed.filter((p) => p.ok).length;

  const boundList = bound.data ?? [];
  const poolList = pool.data ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          对标账号 · {boundList.length}
        </CardTitle>
        <Sheet
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            if (!o) setText("");
          }}
        >
          <SheetTrigger render={<Button variant="outline" size="sm" />}>
            <Plus data-icon="inline-start" />
            管理对标
          </SheetTrigger>
          <SheetContent className="flex w-full flex-col gap-0 sm:max-w-md">
            <SheetHeader>
              <SheetTitle>管理对标账号</SheetTitle>
              <SheetDescription>
                从已有对标账号选择，或粘贴新链接导入并绑定。灵感小鹅会巡视绑定的对标账号并生成选题。
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-4">
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium">从已有对标账号选择</p>
                {poolList.length === 0 ? (
                  <p className="text-xs text-muted-foreground">还没有对标账号，可在下方粘贴链接导入。</p>
                ) : (
                  poolList.map((c) => {
                    const isBound = boundIds.has(c.id);
                    return (
                      <div key={c.id} className="flex items-center gap-2.5 rounded border p-2 text-xs">
                        <CompetitorAvatar name={c.name} avatarUrl={c.avatarUrl} className="size-7" />
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate font-medium">{c.name ?? c.url}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {PLATFORM_LABEL[c.platform]}
                            {c.subscriberCount != null
                              ? ` · ${formatFollowerCount(c.subscriberCount)} ${followerNoun(c.platform)}`
                              : ""}
                          </span>
                        </div>
                        <Button
                          size="sm"
                          variant={isBound ? "secondary" : "outline"}
                          disabled={bindM.isPending || unbindM.isPending}
                          onClick={() =>
                            isBound
                              ? unbindM.mutate({ projectId, competitorAccountId: c.id })
                              : bindM.mutate({ projectId, competitorAccountId: c.id })
                          }
                        >
                          {isBound ? (
                            <>
                              <Check data-icon="inline-start" />
                              已绑定
                            </>
                          ) : (
                            "绑定"
                          )}
                        </Button>
                      </div>
                    );
                  })
                )}
              </div>

              <Field>
                <FieldLabel htmlFor="proj-import">导入新对标（每行一个链接）</FieldLabel>
                <Textarea
                  id="proj-import"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={4}
                  placeholder={"https://www.youtube.com/@example\nhttps://www.xiaohongshu.com/user/profile/...\nhttps://www.douyin.com/user/..."}
                />
                {parsed.length > 0 ? (
                  <p className="text-[10px] text-muted-foreground">
                    {validCount}/{parsed.length} 格式正确
                  </p>
                ) : null}
              </Field>
            </div>

            <SheetFooter className="mt-auto">
              <div className="flex items-center gap-3">
                <Button
                  disabled={validCount === 0 || importM.isPending}
                  onClick={() =>
                    importM.mutate({
                      projectId,
                      competitors: parsed.filter((p) => p.ok).map((p) => ({ platform: p.platform, url: p.url })),
                    })
                  }
                >
                  {importM.isPending ? "导入中…" : `导入并绑定 ${validCount} 个`}
                </Button>
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  完成
                </Button>
              </div>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </CardHeader>
      <CardContent>
        {bound.isLoading ? (
          <p className="text-xs text-muted-foreground">加载中…</p>
        ) : boundList.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            未绑定对标 — 点「管理对标」添加。灵感小鹅需要至少一个对标才能巡视。
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {boundList.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-2.5 rounded-md border bg-card px-2.5 py-2"
              >
                <CompetitorAvatar name={c.name} avatarUrl={c.avatarUrl} className="size-8" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">{c.name ?? c.url}</span>
                  <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span>{PLATFORM_LABEL[c.platform]}</span>
                    {c.subscriberCount != null ? (
                      <span>
                        {formatFollowerCount(c.subscriberCount)} {followerNoun(c.platform)}
                      </span>
                    ) : null}
                  </span>
                </div>
                <button
                  type="button"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => unbindM.mutate({ projectId, competitorAccountId: c.id })}
                  aria-label="解绑"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
