"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

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
import { PLATFORM_LABEL } from "@/lib/platform";
import { trpc } from "@/lib/trpc";
import {
  createChannelInput,
  isValidDouyinProfileUrl,
  isValidXhsProfileUrl,
  isValidYoutubeChannelUrl,
} from "@/server/trpc/schemas/channels";

import { ChannelUrlPreview } from "./channel-url-preview";

export function CreateChannelForm() {
  const router = useRouter();
  const utils = trpc.useUtils();

  const [name, setName] = useState("");
  const [platform, setPlatform] = useState<"youtube" | "xhs" | "douyin">("youtube");
  const [platformUrl, setPlatformUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  const createMutation = trpc.channels.create.useMutation({
    onSuccess: (channel) => {
      utils.channels.list.invalidate();
      toast.success(`已创建「${channel.name}」· 接下来生成频道圣经`);
      router.push(`/accounts/${encodeURIComponent(channel.slug)}`);
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const url = platformUrl.trim();
    if (url) {
      const isValidUrl =
        platform === "youtube"
          ? isValidYoutubeChannelUrl(url)
          : platform === "douyin"
            ? isValidDouyinProfileUrl(url)
            : isValidXhsProfileUrl(url);
      if (!isValidUrl) {
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

    const result = createChannelInput.safeParse({ name, platform, platformUrl: url });
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    createMutation.mutate(result.data);
  }

  return (
    <form onSubmit={handleSubmit} className="flex max-w-xl flex-col gap-6">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="name">账号名称</FieldLabel>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例：摄影老司机"
            required
            autoFocus
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="platform">平台</FieldLabel>
          <Select value={platform} onValueChange={(v) => setPlatform(v as "youtube" | "xhs" | "douyin")}>
            <SelectTrigger id="platform">
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
          <FieldLabel htmlFor="platformUrl">主页链接（选填）</FieldLabel>
          <Input
            id="platformUrl"
            type="url"
            value={platformUrl}
            onChange={(e) => setPlatformUrl(e.target.value)}
            placeholder={
              platform === "youtube"
                ? "https://www.youtube.com/@channel"
                : platform === "douyin"
                  ? "https://www.douyin.com/user/... 或 v.douyin.com 分享短链"
                  : "https://www.xiaohongshu.com/user/profile/..."
            }
          />
          <p className="text-[11px] leading-snug text-muted-foreground">
            只有以后想用 Clerk「复盘」自己这个账号时才需要填；账号的定位在下一步用频道圣经描述。
          </p>
          <ChannelUrlPreview platform={platform} url={platformUrl} />
        </Field>
      </FieldGroup>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={createMutation.isPending}>
          {createMutation.isPending ? "创建中…" : "创建账号"}
        </Button>
        <Button variant="ghost" type="button" onClick={() => router.back()}>
          取消
        </Button>
      </div>
    </form>
  );
}
