import { generateText } from "ai";

import { llm, type LlmTier } from "@goooose/integrations/clients/llm";
import { buildVideoMapSummaryPrompt } from "@goooose/prompts/clerk";

// A valid summary is 300-550 words; anything this short is a flaky/empty/truncated generation.
const MIN_SUMMARY_CHARS = 120;

// MAP step of the SOP map-reduce. Flash carries the per-video fan-out but intermittently
// returns empty/truncated text; the summary is cached on the row, so the Pro retry costs
// at most once per video.
export async function summarizeVideoForSop(args: {
  title: string;
  views: number | null;
  durationSec: number | null;
  contentType?: "video" | "xhs_image" | "xhs_video" | "douyin_image" | "douyin_video";
  transcript: string | null;
  analysis: string;
  language?: "en" | "zh";
  logger?: { info?: (m: string) => void; warn?: (m: string) => void };
}): Promise<string> {
  const prompt = buildVideoMapSummaryPrompt({
    title: args.title,
    views: args.views,
    durationSec: args.durationSec,
    contentType: args.contentType,
    transcript: args.transcript,
    analysis: args.analysis,
    language: args.language,
  });
  const run = async (tier: LlmTier) => {
    const result = await generateText({
      model: llm(tier),
      prompt,
      maxOutputTokens: 1200,
      temperature: 0.3,
      maxRetries: 2,
    });
    return result.text.trim();
  };
  let out = await run("flash");
  if (out.length < MIN_SUMMARY_CHARS) {
    args.logger?.warn?.(
      `SOP map summary thin on flash (${out.length} chars) for "${args.title.slice(0, 50)}" — retrying on pro`,
    );
    const pro = await run("pro");
    if (pro.length > out.length) out = pro;
  }
  if (out.length < MIN_SUMMARY_CHARS) {
    throw new Error(`map summary too short (${out.length} chars)`);
  }
  args.logger?.info?.(`SOP map summary: ${args.title.slice(0, 50)} → ${out.length} chars`);
  return out;
}
