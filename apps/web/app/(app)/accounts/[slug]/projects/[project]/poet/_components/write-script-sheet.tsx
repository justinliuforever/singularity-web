"use client";

import Link from "next/link";
import { useState } from "react";
import { PenLine, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
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
import { sopTypeLabel } from "@/lib/sop-labels";
import { trpc } from "@/lib/trpc";

// Shared write-time settings for both script sources (muse idea / custom topic):
// duration plus the playbook pick Krista asked for — full-account SOP or a
// single-video 拆解. Replaces the two duplicated duration dropdowns.
type Props = {
  channelId: string;
  projectId: string;
  channelSlug?: string;
  topicLabel: string;
  pending: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onSubmit: (durationSeconds: number, sopId: string | undefined) => void;
};

const DURATIONS = [
  { seconds: 30, label: "30 秒", hint: "≈ 100 字" },
  { seconds: 60, label: "60 秒", hint: "≈ 200 字" },
  { seconds: 180, label: "3 分钟", hint: "≈ 600 字" },
  { seconds: 300, label: "5 分钟", hint: "≈ 1000 字，单次写出" },
  { seconds: 600, label: "10 分钟", hint: "≈ 2000 字，大纲→分段" },
  { seconds: 1200, label: "20 分钟", hint: "≈ 4000 字，大纲→分段" },
  { seconds: 1800, label: "30 分钟", hint: "≈ 6000 字，大纲→分段" },
] as const;

const SOP_GROUP_LABEL = {
  competitor: "对标账号 SOP",
  single_video: "单条爆款拆解",
  own: "我的账号 SOP",
} as const;

// Sentinel — Base UI Select values are strings, undefined means "use project primary".
const PRIMARY = "__primary__";

export function WriteScriptSheet({
  channelId,
  projectId,
  channelSlug,
  topicLabel,
  pending,
  disabled,
  disabledReason,
  onSubmit,
}: Props) {
  const [open, setOpen] = useState(false);
  const [seconds, setSeconds] = useState<number>(300);
  const [custom, setCustom] = useState("");
  const [sopChoice, setSopChoice] = useState<string>(PRIMARY);

  const sopOptions = trpc.poet.sopOptions.useQuery(
    { channelId, projectId },
    { enabled: open },
  );
  const options = sopOptions.data?.options ?? [];
  const primarySopId = sopOptions.data?.primarySopId ?? null;
  const noPrimary = sopOptions.data != null && !primarySopId;
  const primaryLabel = primarySopId ? "默认 · 项目主 SOP" : "不使用 SOP";

  if (disabled) {
    return (
      <Button
        size="sm"
        variant="outline"
        disabled
        title={disabledReason}
        onClick={() => disabledReason && toast.error(disabledReason)}
      >
        <PenLine className="size-3" />
        写稿
      </Button>
    );
  }

  const groups = (["competitor", "single_video", "own"] as const)
    .map((key) => ({
      key,
      label: SOP_GROUP_LABEL[key],
      items: options.filter((o) => o.group === key),
    }))
    .filter((g) => g.items.length > 0);
  const chosen = options.find((o) => o.id === sopChoice) ?? null;

  const optionLabel = (o: (typeof options)[number]) =>
    `${o.label} · ${sopTypeLabel(o.sopType)}${o.id === primarySopId ? " · 当前默认" : ""}`;

  const resolveSeconds = (): number | null => {
    if (custom.trim()) {
      const sec = Math.round(Number(custom));
      if (!Number.isFinite(sec) || sec < 15 || sec > 3600) {
        toast.error("自定义时长请输入 15–3600 之间的秒数");
        return null;
      }
      return sec;
    }
    return seconds;
  };

  const submit = () => {
    const sec = resolveSeconds();
    if (sec === null) return;
    setOpen(false);
    onSubmit(sec, sopChoice === PRIMARY ? undefined : sopChoice);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button size="sm" variant="outline" disabled={pending} />}>
        {pending ? <Loader2 className="size-3 animate-spin" /> : <PenLine className="size-3" />}
        写稿
      </SheetTrigger>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>写稿设置</SheetTitle>
          <SheetDescription className="line-clamp-2">{topicLabel}</SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-4">
          <FieldGroup>
            <Field>
              <FieldLabel>视频时长</FieldLabel>
              <div className="grid grid-cols-2 gap-2">
                {DURATIONS.map((d) => (
                  <button
                    key={d.seconds}
                    type="button"
                    onClick={() => {
                      setSeconds(d.seconds);
                      setCustom("");
                    }}
                    className={`flex flex-col items-start gap-0.5 rounded-md border p-2 text-left text-xs transition-colors ${
                      !custom.trim() && seconds === d.seconds
                        ? "border-foreground bg-foreground/5"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    <span className="text-sm font-medium">{d.label}</span>
                    <span className="text-[10px] text-muted-foreground">{d.hint}</span>
                  </button>
                ))}
                <div className="flex flex-col justify-center gap-1 rounded-md border p-2">
                  <span className="text-[10px] text-muted-foreground">自定义（秒，15–3600）</span>
                  <input
                    type="number"
                    min={15}
                    max={3600}
                    value={custom}
                    onChange={(e) => setCustom(e.target.value)}
                    placeholder="如 45"
                    className="h-7 w-full rounded border bg-background px-2 text-sm"
                  />
                </div>
              </div>
            </Field>

            {noPrimary && sopChoice === PRIMARY ? (
              <div className="flex flex-col gap-2 rounded-md border border-amber-600/40 bg-amber-500/10 p-3 text-xs">
                <span className="font-medium">
                  {options.length > 0 ? "本项目还没有默认 SOP" : "该账号还没有任何 SOP"}
                </span>
                <span className="text-muted-foreground">
                  SOP 来自操盘小鹅的分析，缺少它脚本会少了结构化的钩子 / 留人指导。
                  {options.length > 0 ? "可以在下面选一份，也可以直接写。" : "可以直接写，也可以先去生成。"}
                </span>
                {channelSlug ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-fit"
                    render={<Link href={`/clerk/${encodeURIComponent(channelSlug)}`} />}
                  >
                    去操盘小鹅分析
                  </Button>
                ) : null}
              </div>
            ) : null}

            {options.length > 0 ? (
              <Field>
                <FieldLabel>打法参考 SOP</FieldLabel>
                <Select value={sopChoice} onValueChange={(v) => setSopChoice(typeof v === "string" ? v : PRIMARY)}>
                  <SelectTrigger className="w-full">
                    <span className="truncate">
                      {sopChoice !== PRIMARY && chosen ? optionLabel(chosen) : primaryLabel}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value={PRIMARY}>{primaryLabel}</SelectItem>
                    </SelectGroup>
                    {groups.map((g) => (
                      <SelectGroup key={g.key}>
                        <SelectLabel>{g.label}</SelectLabel>
                        {g.items.map((o) => (
                          <SelectItem key={o.id} value={o.id}>
                            <span className="block max-w-[22rem] truncate">{optionLabel(o)}</span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  脚本的结构、钩子和留人节奏会按选中的 SOP 来；选「单条爆款拆解」即按那条爆款的打法写
                </p>
              </Field>
            ) : null}
          </FieldGroup>
        </div>

        <SheetFooter>
          <div className="flex items-center gap-3">
            <Button onClick={submit} disabled={pending}>
              {pending ? (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              ) : (
                <PenLine data-icon="inline-start" />
              )}
              开始写稿
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              取消
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
