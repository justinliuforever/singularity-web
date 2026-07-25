"use client";

import { FileText, Loader2, Sparkles, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { type DragEvent, type FormEvent, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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

type Props = {
  channelId: string;
  channelName: string;
  channelDescription: string | null;
  buttonLabel: string;
  buttonVariant?: "default" | "outline";
};

const CHUNK_BYTES = 2 * 1024 * 1024;
const MAX_BYTES = 15 * 1024 * 1024;
const EXT_MIME: Record<string, string> = {
  md: "text/markdown",
  txt: "text/plain",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function fileMime(file: File): string | null {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_MIME[ext] ?? null;
}

function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function BibleGenerateSheet({
  channelId,
  channelName,
  channelDescription,
  buttonLabel,
  buttonVariant = "default",
}: Props) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"idea" | "file">("idea");
  const [name, setName] = useState("");
  const [ideaText, setIdeaText] = useState(channelDescription ?? "");
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const mutation = trpc.poet.generateBible.useMutation({
    onSuccess: () => {
      toast.info(`已开始为「${channelName}」生成频道圣经`);
      utils.invalidate();
      router.refresh();
      setOpen(false);
    },
    onError: (err) => setError(err.message),
  });

  const createUpload = trpc.poet.createBibleUpload.useMutation();
  const uploadChunk = trpc.poet.uploadBibleChunk.useMutation();
  const finalize = trpc.poet.finalizeBibleImport.useMutation();
  const importing = uploadPct !== null;

  function pickFile(f: File | undefined | null) {
    setError(null);
    if (!f) return;
    if (!fileMime(f)) {
      setError("仅支持 .md / .txt / .pdf / .docx 文件");
      return;
    }
    if (f.size > MAX_BYTES) {
      setError(`文件超过 ${formatBytes(MAX_BYTES)} 上限`);
      return;
    }
    if (f.size === 0) {
      setError("文件为空");
      return;
    }
    setFile(f);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    pickFile(e.dataTransfer.files?.[0]);
  }

  async function runImport() {
    if (!file) {
      setError("请先选择或拖入文件");
      return;
    }
    setError(null);
    setUploadPct(0);
    try {
      const buf = await file.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", buf);
      const sha256 = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
      const chunkCount = Math.ceil(buf.byteLength / CHUNK_BYTES);
      const { fileId } = await createUpload.mutateAsync({
        channelId,
        filename: file.name,
        mime: fileMime(file)! as never,
        size: buf.byteLength,
        sha256,
        chunkCount,
      });
      for (let i = 0; i < chunkCount; i++) {
        const slice = new Uint8Array(buf.slice(i * CHUNK_BYTES, Math.min((i + 1) * CHUNK_BYTES, buf.byteLength)));
        let bin = "";
        // 32KB stride keeps String.fromCharCode off the arg-count limit.
        for (let o = 0; o < slice.length; o += 32768) {
          bin += String.fromCharCode(...slice.subarray(o, o + 32768));
        }
        await uploadChunk.mutateAsync({ fileId, idx: i, dataBase64: btoa(bin) });
        setUploadPct(Math.round(((i + 1) / (chunkCount + 1)) * 100));
      }
      await finalize.mutateAsync({ fileId, name: name.trim() || undefined, language: "zh" });
      setUploadPct(100);
      toast.info(`已开始解析「${file.name}」并生成频道圣经`);
      utils.invalidate();
      router.refresh();
      setOpen(false);
      setFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败，请重试");
    } finally {
      setUploadPct(null);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === "file") {
      void runImport();
      return;
    }
    if (ideaText.trim().length < 20) {
      setError("请用至少 20 个字描述这个频道想做什么");
      return;
    }
    mutation.mutate({
      channelId,
      ideaText: ideaText.trim(),
      name: name.trim() || undefined,
      language: "zh",
    });
  }

  const busy = mutation.isPending || importing;

  return (
    <Sheet open={open} onOpenChange={(v) => (busy ? null : setOpen(v))}>
      <SheetTrigger render={<Button variant={buttonVariant} size="sm" />}>
        <Sparkles data-icon="inline-start" />
        {buttonLabel}
      </SheetTrigger>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>生成频道圣经</SheetTitle>
          <SheetDescription>
            描述你想做的频道，或直接导入现成的人设 / IP 文档（md / pdf / docx）
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex flex-1 flex-col gap-6 overflow-y-auto p-4">
          <div className="flex gap-1 rounded-lg border bg-muted/40 p-1">
            <Button
              type="button"
              size="sm"
              variant={mode === "idea" ? "secondary" : "ghost"}
              className="flex-1"
              onClick={() => setMode("idea")}
              disabled={busy}
            >
              描述想法
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === "file" ? "secondary" : "ghost"}
              className="flex-1"
              onClick={() => setMode("file")}
              disabled={busy}
            >
              导入文件
            </Button>
          </div>

          <p className="rounded-md bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            {mode === "idea"
              ? "AI 会基于你的描述推断并补全成完整框架（受众、人设、内容方向等）——给的信息越少，AI 推断补充的部分越多。"
              : "逐字保留文档内容，只归类整理、不改写不总结；每个数字都会与原文核对，存疑处生成后需要你逐项确认。"}
          </p>

          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="bible-name">名称（可选）</FieldLabel>
              <Input
                id="bible-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="留空将使用 AI 提取的话题"
                disabled={busy}
              />
            </Field>

            {mode === "idea" ? (
              <Field>
                <FieldLabel htmlFor="bible-idea">频道想法</FieldLabel>
                <Textarea
                  id="bible-idea"
                  value={ideaText}
                  onChange={(e) => setIdeaText(e.target.value)}
                  placeholder="例如：面向小红书的露营装备频道，主打实测体验与避坑指南"
                  rows={8}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  越具体越好。如果填得太泛，AI 可能「偏题」——系统会自动检测并提示
                </p>
              </Field>
            ) : (
              <Field>
                <FieldLabel>人设 / IP 文档</FieldLabel>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => fileInputRef.current?.click()}
                  onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={onDrop}
                  className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center text-sm transition-colors ${
                    dragOver ? "border-poet bg-poet/5" : "border-muted-foreground/25 hover:border-muted-foreground/50"
                  }`}
                >
                  {file ? (
                    <>
                      <FileText className="size-6 text-poet" />
                      <span className="max-w-full truncate font-medium">{file.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatBytes(file.size)} · 点击更换
                      </span>
                    </>
                  ) : (
                    <>
                      <Upload className="size-6 text-muted-foreground" />
                      <span className="text-muted-foreground">拖拽文件到这里，或点击选择</span>
                      <span className="text-xs text-muted-foreground">
                        .md / .txt / .pdf / .docx，≤ {formatBytes(MAX_BYTES)}
                      </span>
                    </>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".md,.txt,.pdf,.docx"
                    className="hidden"
                    onChange={(e) => pickFile(e.target.files?.[0])}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  AI 会逐字转写文档（含扫描件与表格截图）并重构为频道圣经；数字与专有名词经多重核对，存疑处会列出请你确认
                </p>
                {importing ? (
                  <div className="flex flex-col gap-1">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div className="h-full bg-poet transition-all" style={{ width: `${uploadPct}%` }} />
                    </div>
                    <span className="text-xs text-muted-foreground">上传中… {uploadPct}%</span>
                  </div>
                ) : null}
              </Field>
            )}
          </FieldGroup>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <SheetFooter className="mt-auto px-0">
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={busy || (mode === "file" && !file)}>
                {busy ? (
                  <Loader2 data-icon="inline-start" className="animate-spin" />
                ) : (
                  <Sparkles data-icon="inline-start" />
                )}
                {busy ? (importing ? "上传中…" : "提交中…") : mode === "file" ? "上传并生成" : "开始生成"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
                取消
              </Button>
            </div>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
