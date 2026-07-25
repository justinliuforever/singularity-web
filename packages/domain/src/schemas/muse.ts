import { z } from "zod";

export const classificationSchema = z.object({
  relevant: z.boolean(),
  topic_classification: z.string().default(""),
  rejection_reason: z.string().default(""),
});

export type Classification = z.infer<typeof classificationSchema>;

export const ideaSchema = z.object({
  story_angle: z.string().default(""),
  facts_and_data: z.string().default(""),
  why_similar: z.string().default(""),
  viral_trigger: z.string().default(""),
  cover_concept: z.string().default(""),
  suggested_hook_type: z.string().default(""),
  risk_factors: z.string().default(""),
});

export const ideasResponseSchema = z.object({
  ideas: z.array(ideaSchema),
});

export type Idea = z.infer<typeof ideaSchema>;

// Fabrication guard: viral_trigger must not run on empty/fake transcripts. Image-post
// "transcripts" are title+desc (~80-300 chars), so the lower floor still catches empty posts.
export const MIN_REAL_TRANSCRIPT_CHARS = 200;
export const MIN_REAL_TRANSCRIPT_CHARS_IMAGE_POST = 50;

const WARNING_MARKERS = [
  "[WARNING: Video transcription failed",
  "[WARNING: VIDEO post but",
  "[WARNING: Video transcription",
];

export type MonitorContentType = "video" | "xhs_video" | "xhs_image" | "douyin_video" | "douyin_image";

export function isRealTranscript(
  text: string | null | undefined,
  contentType: MonitorContentType = "video",
): boolean {
  if (!text) return false;
  if (WARNING_MARKERS.some((m) => text.includes(m))) return false;
  const floor = contentType.endsWith("_image")
    ? MIN_REAL_TRANSCRIPT_CHARS_IMAGE_POST
    : MIN_REAL_TRANSCRIPT_CHARS;
  return text.trim().length >= floor;
}
