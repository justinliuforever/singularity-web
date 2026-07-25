"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";

import type { Channel } from "@goooose/db";

import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
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
import { PLATFORM_LABEL } from "@/lib/platform";
import { trpc } from "@/lib/trpc";
import {
  isValidDouyinProfileUrl,
  isValidXhsProfileUrl,
  isValidYoutubeChannelUrl,
  updateChannelInput,
} from "@/server/trpc/schemas/channels";

import { ChannelUrlPreview } from "./channel-url-preview";

type Props = {
  channel: Channel;
};

export function EditChannelSheet({ channel }: Props) {
  const router = useRouter();
  const utils = trpc.useUtils();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState(channel.name);
  const [platform, setPlatform] = useState<"youtube" | "xhs" | "douyin">(channel.platform);
  const [platformUrl, setPlatformUrl] = useState(channel.platformUrl);
  const [description, setDescription] = useState(channel.description ?? "");
  const [error, setError] = useState<string | null>(null);

  const updateMutation = trpc.channels.update.useMutation({
    onSuccess: (updated) => {
      utils.channels.list.invalidate();
      utils.channels.bySlug.invalidate({ slug: updated.slug });
      toast.success(`已更新「${updated.name}」`);
      setOpen(false);
      router.refresh();
    },
    onError: (err) => setError(err.message),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const url = platformUrl.trim();
    if (url) {
      const ownUrlOk =
        platform === "youtube"
          ? isValidYoutubeChannelUrl(url)
          : platform === "douyin"
            ? isValidDouyinProfileUrl(url)
            : isValidXhsProfileUrl(url);
      if (!ownUrlOk) {
        setError(
          platform === "youtube"
            ? "URL 不符合 YouTube 频道格式（应为 /@handle、/channel/UCxxx、/c/name 或 /user/name）"
            : platform === "douyin"
              ? "URL 不符合抖音主页格式（应为 https://www.douyin.com/user/... 或 v.douyin.com 分享短链）"
              : "URL 不符合小红书主页格式（应为 https://www.xiaohongshu.com/user/profile/{24位hex}）",
        );
        return;
      }
    }

    const result = updateChannelInput.safeParse({
      id: channel.id,
      name,
      platform,
      platformUrl: url,
      description: description || null,
    });
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? "Invalid input");
      return;
    }

    const platformChanged = platform !== channel.platform;
    const urlChanged = platformUrl !== channel.platformUrl;
    if (platformChanged || urlChanged) {
      const lines: string[] = ["⚠️ 你正在修改：" ];
      if (platformChanged) lines.push(`• 平台 (${channel.platform} → ${platform})`);
      if (urlChanged) lines.push(`• 主页链接`);
      lines.push("");
      lines.push("如果该频道已经跑过操盘小鹅、灵感小鹅、神笔小鹅，旧数据是基于原值生成的，会与新值不一致。建议改完后清空旧数据重跑。");
      lines.push("");
      lines.push("仍要继续吗？");
      if (!confirm(lines.join("\n"))) return;
    }

    updateMutation.mutate(result.data);
  }

  const regenerateMutation = trpc.channels.regenerateSlug.useMutation({
    onSuccess: (fresh) => {
      utils.channels.list.invalidate();
      utils.channels.bySlug.invalidate();
      toast.success(`URL 路径已更新为 ${fresh.slug}`);
      setOpen(false);
      router.replace(`/accounts/${encodeURIComponent(fresh.slug)}`);
    },
    onError: (err) => setError(err.message),
  });

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button variant="outline" size="sm" />}>
        <Pencil data-icon="inline-start" />
        编辑
      </SheetTrigger>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>编辑账号</SheetTitle>
          <SheetDescription>修改名称、平台、对标后保存即可。</SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex flex-1 flex-col gap-6 overflow-y-auto p-4">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="edit-name">账号名称</FieldLabel>
              <Input
                id="edit-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </Field>

            <Field>
              <FieldLabel>URL 路径</FieldLabel>
              <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2">
                <code className="truncate font-mono text-xs">/accounts/{channel.slug}</code>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={regenerateMutation.isPending}
                  onClick={() => {
                    if (!confirm("将根据当前频道名称重新生成 URL 路径，老链接会失效。继续？")) return;
                    regenerateMutation.mutate({ id: channel.id });
                  }}
                >
                  {regenerateMutation.isPending ? "更新中…" : "重置"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                URL 路径在首次创建时根据名称生成；改名后默认保持不变。点「重置」可根据当前名称重生成。
              </p>
            </Field>

            <Field>
              <FieldLabel htmlFor="edit-platform">平台</FieldLabel>
              <Select
                value={platform}
                onValueChange={(v) => setPlatform(v as "youtube" | "xhs" | "douyin")}
              >
                <SelectTrigger id="edit-platform">
                  {PLATFORM_LABEL[platform]}
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="youtube">YouTube</SelectItem>
                    <SelectItem value="xhs">小红书</SelectItem>
                    <SelectItem value="douyin">抖音</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel htmlFor="edit-url">主页链接（选填）</FieldLabel>
              <Input
                id="edit-url"
                type="url"
                value={platformUrl}
                onChange={(e) => setPlatformUrl(e.target.value)}
                placeholder={
                  platform === "xhs"
                    ? "https://www.xiaohongshu.com/user/profile/{user_id}"
                    : platform === "douyin"
                      ? "https://www.douyin.com/user/... 或 v.douyin.com 分享短链"
                      : "https://www.youtube.com/@handle"
                }
              />
              <ChannelUrlPreview platform={platform} url={platformUrl} />
            </Field>

            <Field>
              <FieldLabel htmlFor="edit-description">描述</FieldLabel>
              <Textarea
                id="edit-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="选填，用于让 AI 了解频道定位"
                rows={4}
              />
            </Field>

          </FieldGroup>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <SheetFooter className="mt-auto px-0">
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "保存中…" : "保存"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
                disabled={updateMutation.isPending}
              >
                取消
              </Button>
            </div>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
