import { AbortTaskRunError, logger, metadata, task } from "@trigger.dev/sdk";
import { and, asc, eq, ne } from "drizzle-orm";

import { bibleImportChunks, bibleImportFiles, channels, pipelineRuns } from "@goooose/db";

import { withMeteredRunDb } from "../lib/metered-run";
import { persistBible } from "../lib/persist-bible";
import { userRunsQueue } from "../lib/queues";
import { generateBibleFromDocument } from "@goooose/domain/services/poet/import-bible";
import { transcribeDocument } from "@goooose/integrations/clients/docTranscribe";
import { safeText } from "@goooose/integrations/utils";

type Payload = {
  channelId: string;
  runId: string;
  userId?: string;
  fileId: string;
  name?: string;
  language?: "en" | "zh";
};

export const importBible = task({
  id: "poet-import-bible",
  queue: userRunsQueue,
  maxDuration: 1800,
  machine: "small-2x",
  run: async (payload: Payload) => {
    const language = payload.language ?? "zh";
    return withMeteredRunDb({ runId: payload.runId, userId: payload.userId, feature: "poet-import-bible" }, async (db) => {
      const [channel] = await db
        .select()
        .from(channels)
        .where(eq(channels.id, payload.channelId))
        .limit(1);
      if (!channel) throw new Error(`channel ${payload.channelId} not found`);

      const [file] = await db
        .select()
        .from(bibleImportFiles)
        .where(eq(bibleImportFiles.id, payload.fileId))
        .limit(1);
      if (!file) throw new AbortTaskRunError("上传的文件不存在或已过期");
      if (file.status !== "ready" && file.status !== "processing") {
        throw new AbortTaskRunError(`文件状态异常（${file.status}），请重新上传`);
      }

      const [started] = await db
        .update(pipelineRuns)
        .set({ status: "running", startedAt: new Date() })
        .where(and(eq(pipelineRuns.id, payload.runId), ne(pipelineRuns.status, "failed")))
        .returning({ id: pipelineRuns.id });
      if (!started) throw new Error("run already settled (reaped) — aborting to avoid double-deliver");
      await db
        .update(bibleImportFiles)
        .set({ status: "processing" })
        .where(eq(bibleImportFiles.id, file.id));

      await metadata.set("progress", {
        current: 0,
        total: 1,
        phase: "loading file",
        detail: `读取并校验「${file.filename}」`,
      });
      const chunks = await db
        .select({ idx: bibleImportChunks.idx, bytes: bibleImportChunks.bytes })
        .from(bibleImportChunks)
        .where(eq(bibleImportChunks.fileId, file.id))
        .orderBy(asc(bibleImportChunks.idx));
      if (chunks.length !== file.expectedChunks) {
        throw new AbortTaskRunError("文件分片不完整，请重新上传");
      }
      const bytes = new Uint8Array(file.size);
      let offset = 0;
      for (const c of chunks) {
        const part = c.bytes instanceof Uint8Array ? c.bytes : new Uint8Array(c.bytes as ArrayBufferLike);
        bytes.set(part, offset);
        offset += part.length;
      }

      const stage1 = await transcribeDocument({
        bytes,
        mime: file.mime,
        onProgress: async (p) => {
          await metadata.set("progress", { current: p.current, total: p.total, phase: p.phase, detail: p.detail });
        },
        logger,
      });
      if (stage1.transcript.trim().length < 200) {
        throw new AbortTaskRunError("无法从文件中提取有效内容（可能是空白或加密的扫描件），请检查文件后重试");
      }

      await metadata.set("progress", {
        current: 0,
        total: 1,
        phase: "writing bible",
        detail: "AI 重构为频道圣经中…",
      });
      const bible = await generateBibleFromDocument(
        {
          transcript: stage1.transcript,
          channelName: channel.name,
          language,
          logger,
        },
        async (chars) => {
          await metadata.set("progress", {
            current: 0,
            total: 1,
            phase: "writing bible",
            detail: `AI 重构为频道圣经中…已生成 ${chars} 字`,
          });
        },
      );

      const cleanContent = safeText(bible.content) ?? "";
      if (!cleanContent) throw new Error("Bible generation returned empty content");
      const flags = [...stage1.flags, ...bible.flags];

      await metadata.set("progress", { current: 1, total: 1, phase: "saving", detail: "保存中" });
      const { inserted, activated } = await persistBible(db, {
        channelId: channel.id,
        name: payload.name?.trim() || bible.topicClaimed || file.filename,
        content: cleanContent,
        sourceIdea: null,
        sourceKind: "file",
        sourceTranscript: stage1.transcript,
        hostName: bible.hostName,
        importFileId: file.id,
        importFlags: flags,
        driftWarning: bible.driftWarning,
        // Flagged imports wait for field-by-field user review before they can be activated.
        blockActivation: flags.length > 0,
      });

      // Raw chunks are only needed for transcription — free the bytea rows now.
      await db.delete(bibleImportChunks).where(eq(bibleImportChunks.fileId, file.id));
      await db.update(bibleImportFiles).set({ status: "consumed" }).where(eq(bibleImportFiles.id, file.id));

      await db
        .update(pipelineRuns)
        .set({ status: "done", completedAt: new Date(), progress: 1, total: 1 })
        .where(eq(pipelineRuns.id, payload.runId));

      return {
        bibleId: inserted?.id ?? null,
        activated,
        needsReview: flags.length > 0,
        flagCount: flags.length,
        hostName: bible.hostName,
        drifted: bible.driftWarning !== null,
        pagesTotal: stage1.pagesTotal,
        imagesTotal: stage1.imagesTotal,
      };
    });
  },
});
