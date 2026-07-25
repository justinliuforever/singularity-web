import { generateTextWithFallback } from "@goooose/integrations/clients/llm";
import { parseLlmJson } from "@goooose/integrations/utils";
import { redactUngrounded } from "../grounding";
import { selectBibleSections } from "./bible";
import { buildTopicAnalysisPrompt } from "@goooose/prompts/poet";
import { factCheckVerbatim, type CheckedFact } from "./factCheck";
import { formatReferencesBlock, type ScriptReference } from "./scriptWriter";

function extractVerifiedSections(content: string): string | undefined {
  // Only these two passed the import digit audit — the trustworthy subset of the bible.
  const out: string[] = [];
  for (const anchor of ["METHODOLOGY", "FACT_SHEET"]) {
    const m = content.match(new RegExp(`^##\\s+${anchor}[^\\n]*\\n([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, "m"));
    if (m?.[1]?.trim()) out.push(m[1]!.trim());
  }
  return out.length ? out.join("\n\n") : undefined;
}

export type TopicAnalysis = {
  storyAngle: string;
  factsAndData: string;
  verbatimFacts: string;
  whySimilar: string;
  viralTrigger: string;
  factChecks: CheckedFact[];
};

export type AnalyzeTopicArgs = {
  topic: string;
  references: ScriptReference[] | null | undefined;
  bibleText: string;
  // True for imported (source_kind='file') bibles whose FACT_SHEET passed the digit audit.
  trustedFactSheet?: boolean;
  sopText: string;
  language: "en" | "zh";
};


function toText(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).trim())
      .filter((s) => s.length > 0)
      .map((s) => (s.startsWith("- ") ? s : `- ${s}`))
      .join("\n");
  }
  return String(value).trim();
}

export async function analyzeTopic(args: AnalyzeTopicArgs): Promise<TopicAnalysis> {
  const verifiedFacts = args.trustedFactSheet ? extractVerifiedSections(args.bibleText) : undefined;
  const prompt = buildTopicAnalysisPrompt({
    // PERSONA/METHODOLOGY are excluded: they are the fact-leak surface this prompt suppresses.
    channelBible: selectBibleSections(args.bibleText, [
      "POSITIONING",
      "AUDIENCE",
      "CONTENT_PILLARS",
      "CONTENT_RULES",
      "TOPIC_FRAMEWORK",
      "INFORMATION_SOURCES",
    ]),
    // Must stay a dedicated block: mixed into the voice-only bible slice, the model
    // anonymized the specifics into 某种/若干 placeholders.
    verifiedFacts,
    sopReference: args.sopText,
    topic: args.topic,
    referencesContext: formatReferencesBlock(args.references ?? null),
    language: args.language,
  });

  let data: Record<string, unknown> = {};
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await generateTextWithFallback({
      prompt,
      temperature: 0.6,
      maxOutputTokens: 6144,
      maxRetries: 2,
    });
    const parsed = await parseLlmJson(result.text);
    if (parsed && typeof parsed === "object") {
      data = parsed as Record<string, unknown>;
      break;
    }
  }

  const analysis: TopicAnalysis = {
    storyAngle: toText(data.story_angle),
    factsAndData: toText(data.facts_and_data),
    verbatimFacts: toText(data.verbatim_facts),
    whySimilar: toText(data.why_similar),
    viralTrigger: toText(data.viral_trigger),
    factChecks: [],
  };
  // The caller marks the topic 'analyzed' and feeds it to script generation, so an
  // empty analysis must fail loudly rather than pass as success.
  if (!analysis.storyAngle && !analysis.factsAndData) {
    throw new Error(
      "Topic analysis produced no usable content (story_angle + facts_and_data empty)",
    );
  }
  // Verified account facts must count as source here — otherwise the empty-references
  // rule generalizes them into 某种/一定范围 placeholders.
  analysis.factsAndData = await redactUngrounded({
    draft: analysis.factsAndData,
    source: [formatReferencesBlock(args.references ?? null), verifiedFacts ?? ""].filter(Boolean).join("\n\n"),
    language: args.language,
    maxOutputTokens: 4096,
  });
  // Catches sourced-but-wrong claims the grounding pass keeps (it trusts cited sources).
  analysis.factChecks = await factCheckVerbatim({
    verbatimFacts: analysis.verbatimFacts,
    referenceTitles: (args.references ?? [])
      .map((r) => r.title)
      .filter((t): t is string => !!t),
    language: args.language,
  });
  return analysis;
}
