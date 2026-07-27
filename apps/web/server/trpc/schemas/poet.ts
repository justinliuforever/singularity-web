import { z } from "zod";

export const generateBibleInput = z.object({
  channelId: z.string().uuid(),
  ideaText: z.string().min(20).max(4000),
  name: z.string().max(120).optional(),
  language: z.enum(["en", "zh"]).default("zh"),
});

export const updateBibleInput = z.object({
  bibleId: z.string().uuid(),
  name: z.string().max(120).optional(),
  content: z.string().min(20).optional(),
});

// Chunked upload: Vercel's 4.5MB body cap forces ≤2MB raw chunks (base64 ~2.7MB).
export const BIBLE_IMPORT_CHUNK_BYTES = 2 * 1024 * 1024;
export const BIBLE_IMPORT_MAX_BYTES = 15 * 1024 * 1024;
export const BIBLE_IMPORT_MIMES = [
  "text/markdown",
  "text/plain",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export const createBibleUploadInput = z.object({
  channelId: z.string().uuid(),
  filename: z.string().min(1).max(255),
  mime: z.enum(BIBLE_IMPORT_MIMES),
  size: z.number().int().min(1).max(BIBLE_IMPORT_MAX_BYTES),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  chunkCount: z.number().int().min(1).max(8),
});

export const uploadBibleChunkInput = z.object({
  fileId: z.string().uuid(),
  idx: z.number().int().min(0).max(7),
  dataBase64: z.string().min(1).max(3_500_000),
});

export const finalizeBibleImportInput = z.object({
  fileId: z.string().uuid(),
  name: z.string().max(120).optional(),
  language: z.enum(["en", "zh"]).default("zh"),
});

export const resolveImportFlagInput = z.object({
  bibleId: z.string().uuid(),
  flagIndex: z.number().int().min(0).max(200),
});

export const switchActiveBibleInput = z.object({
  bibleId: z.string().uuid(),
  // Account-level pages omit projectId; only a project context sets the per-project pin.
  projectId: z.string().uuid().optional(),
});

// Duration in seconds (supports ≤60s short videos). ≥ 2000 zh chars / ≥ 1500 en
// words (≈10 min) routes to long-form.
export const generateScriptInput = z.object({
  channelId: z.string().uuid(),
  projectId: z.string().uuid(),
  ideaId: z.string().uuid(),
  durationSeconds: z.number().int().min(15).max(3600).default(300),
  language: z.enum(["en", "zh"]).default("zh"),
});

export const customTopicReferenceInput = z.object({
  kind: z.enum(["youtube", "xhs", "douyin", "text"]),
  url: z.string().url().optional(),
  text: z.string().max(20000).optional(),
  title: z.string().max(200).optional(),
});

export const createCustomTopicInput = z.object({
  channelId: z.string().uuid(),
  projectId: z.string().uuid(),
  topic: z.string().min(5).max(2000),
  references: z.array(customTopicReferenceInput).max(10).default([]),
  language: z.enum(["en", "zh"]).default("zh"),
  sourceIdeaId: z.string().uuid().optional(),
});

export const updateCustomTopicInput = z.object({
  topicId: z.string().uuid(),
  topic: z.string().min(5).max(2000).optional(),
  references: z.array(customTopicReferenceInput).max(10).optional(),
  language: z.enum(["en", "zh"]).optional(),
});

export const deleteCustomTopicInput = z.object({
  topicId: z.string().uuid(),
});

export const deleteBibleInput = z.object({
  bibleId: z.string().uuid(),
});

export const deleteScriptInput = z.object({
  scriptId: z.string().uuid(),
});

export const renameScriptInput = z.object({
  scriptId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
});

export const analyzeCustomTopicInput = z.object({
  channelId: z.string().uuid(),
  projectId: z.string().uuid(),
  topicId: z.string().uuid(),
  language: z.enum(["en", "zh"]).default("zh"),
});

export const generateScriptFromCustomTopicInput = z.object({
  channelId: z.string().uuid(),
  projectId: z.string().uuid(),
  topicId: z.string().uuid(),
  durationSeconds: z.number().int().min(15).max(3600).default(300),
  language: z.enum(["en", "zh"]).default("zh"),
});
