import { generateText } from "ai";
import { parseLlmJson } from "@goooose/integrations/utils";

import { generateTextWithFallback, llm } from "@goooose/integrations/clients/llm";
import {
  buildClassificationPrompt,
  buildIdeaGenerationPrompt,
  buildViralTriggerPrompt,
} from "@goooose/prompts/muse";
import {
  type Classification,
  classificationSchema,
  type Idea,
  ideasResponseSchema,
} from "../schemas/muse";

const TRANSCRIPT_PREVIEW_CHARS = 2000;

export type ClassifyArgs = {
  channelDescription: string;
  title: string;
  channelName: string;
  views: number;
  durationSec: number;
  transcript: string | null;
  language?: "en" | "zh";
};

export async function classifyVideo(args: ClassifyArgs): Promise<Classification> {
  const transcriptPreview = args.transcript
    ? args.transcript.slice(0, TRANSCRIPT_PREVIEW_CHARS)
    : null;
  const prompt = buildClassificationPrompt({
    channelDescription: args.channelDescription,
    title: args.title,
    channelName: args.channelName,
    views: args.views,
    durationSec: args.durationSec,
    transcriptPreview,
    language: args.language,
  });
  // 1500-token floor leaves room for V4 reasoning preamble; 512 starved Chinese prompts.
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await generateText({
      model: llm("flash"),
      prompt,
      temperature: 0.2,
      maxOutputTokens: 1500,
      maxRetries: 2,
    });
    const parsed = await parseLlmJson(result.text);
    const valid = classificationSchema.safeParse(parsed);
    if (valid.success) return valid.data;
  }
  // Default to relevant — sloppy model output is more likely than truly irrelevant content.
  return { relevant: true, topic_classification: "", rejection_reason: "" };
}

export type ViralTriggerArgs = {
  channelDescription: string;
  title: string;
  channelName: string;
  views: number;
  durationSec: number;
  transcript: string;
  language?: "en" | "zh";
};

export async function analyzeViralTrigger(args: ViralTriggerArgs): Promise<string> {
  const prompt = buildViralTriggerPrompt(args);
  const result = await generateTextWithFallback({
    prompt,
    temperature: 0.4,
    maxOutputTokens: 4096,
    maxRetries: 2,
  });
  return result.text.trim();
}

export type GenerateIdeasArgs = {
  channelDescription: string;
  title: string;
  channelName: string;
  views: number;
  viralTrigger: string;
  numIdeas?: number;
  language?: "en" | "zh";
  biblePositioning?: string;
  transcript?: string | null;
};

export type GenerateIdeasResult = {
  ideas: Idea[];
  rawSample: string | null;
  parseErrorSample: string | null;
};

export async function generateIdeas(args: GenerateIdeasArgs): Promise<GenerateIdeasResult> {
  const numIdeas = args.numIdeas ?? 5;
  const prompt = buildIdeaGenerationPrompt({
    channelDescription: args.channelDescription,
    title: args.title,
    channelName: args.channelName,
    views: args.views,
    viralTrigger: args.viralTrigger,
    numIdeas,
    language: args.language,
    biblePositioning: args.biblePositioning,
    transcript: args.transcript,
  });

  // Blank/half-truncated ideas are dropped so a partial response isn't saved as success.
  let lastText = "";
  let lastIssues = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await generateTextWithFallback({
      prompt,
      temperature: 0.7,
      maxOutputTokens: 8192,
      maxRetries: 2,
    });
    lastText = result.text;
    const parsed = await parseLlmJson(result.text);
    const valid = ideasResponseSchema.safeParse(parsed);
    if (valid.success) {
      const complete = valid.data.ideas.filter(
        (i) => i.story_angle.trim().length > 0 && i.facts_and_data.trim().length > 0,
      );
      if (complete.length >= numIdeas || (attempt === 1 && complete.length > 0)) {
        return { ideas: complete.slice(0, numIdeas), rawSample: null, parseErrorSample: null };
      }
    } else {
      lastIssues = JSON.stringify(valid.error.issues.slice(0, 3)).slice(0, 400);
    }
  }
  return {
    ideas: [],
    rawSample: lastText.slice(0, 600),
    parseErrorSample: lastIssues || "incomplete ideas after retry",
  };
}
