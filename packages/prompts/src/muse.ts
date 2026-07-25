import { CHINESE_WRAPPER } from "./clerk";

const NO_TRANSCRIPT_PLACEHOLDER = "[No transcript — classify based on title only]";

type ClassificationArgs = {
  channelDescription: string;
  title: string;
  channelName: string;
  views: number;
  durationSec: number;
  transcriptPreview: string | null;
  language?: "en" | "zh";
};

export function buildClassificationPrompt(args: ClassificationArgs): string {
  const inner = `You are a content strategist specializing in cross-niche adaptation. The user has INTENTIONALLY chosen this competitor channel to study — your job is to identify what viral mechanisms can be extracted and adapted, NOT to judge whether the content topics match.

## Target Channel Description
${args.channelDescription}

## Competitor Video
- **Title:** ${args.title}
- **Channel:** ${args.channelName}
- **Views:** ${args.views.toLocaleString("en-US")} (may be a weighted engagement score, not raw plays, for XHS/Douyin sources)
- **Duration:** ${args.durationSec} seconds

## Transcript (excerpt)
${args.transcriptPreview ?? NO_TRANSCRIPT_PLACEHOLDER}

## Instructions

Determine whether this video contains a TRANSFERABLE viral mechanism:
1. "Relevant" means: the video has an identifiable viral MECHANISM (hook structure, emotional arc, narrative technique, audience psychology) that could be adapted to the target channel — even if the surface-level topic, tone, or audience is completely different.
2. A comedy video IS relevant to an educational channel if it uses a great curiosity gap. A kids' show IS relevant to an adult channel if it uses effective escalation. Focus on the MECHANISM, not the content.
3. Default to RELEVANT. Only mark as irrelevant if the video is truly low-effort filler (e.g., channel trailer, behind-the-scenes vlog, compilation with no structure, or very short clips under 30 seconds with no hook).

Return a JSON object:
- "relevant": true or false
- "topic_classification": short label describing the video's format/mechanism (e.g., "Myth-Busting", "Escalating Satire", "Ranking/Listicle", "Character Study", "Holiday Special")
- "rejection_reason": if false, explain why in one sentence. If true, leave as "".

Return ONLY valid JSON.
`;
  if (args.language !== "zh") {
    return `${inner}\n\nWrite the rejection_reason and topic_classification values in English.`;
  }
  return (
    CHINESE_WRAPPER(inner) +
    '\n\nIMPORTANT: JSON keys must remain in English (relevant, topic_classification, rejection_reason). Only the rejection_reason string and topic_classification label should be in Simplified Chinese.'
  );
}

type ViralTriggerArgs = {
  channelDescription: string;
  title: string;
  channelName: string;
  views: number;
  durationSec: number;
  transcript: string;
  language?: "en" | "zh";
};

export function buildViralTriggerPrompt(args: ViralTriggerArgs): string {
  const inner = `You are a viral content analyst. Analyze WHY this content performed well.

## Target Channel (for adaptation context)
${args.channelDescription}

## Source Video
- **Title:** ${args.title}
- **Channel:** ${args.channelName}
- **Views:** ${args.views.toLocaleString("en-US")} (may be a weighted engagement score, not raw plays, for XHS/Douyin sources)
- **Duration:** ${args.durationSec} seconds

## Full Transcript
${args.transcript}

## Instructions

Identify the VIRAL TRIGGER:
1. **Click Trigger**: What made people click?
2. **Watch Trigger**: What kept them watching?
3. **Share Trigger**: What would make someone share this?

Synthesize into 2-3 sentences covering: why people click, why they keep watching, why they would share — then end with a one-line statement of the core viral mechanism. Base this ONLY on the transcript above; do not invent specifics that are not present in it. Do not use bracketed placeholders or an English template.

Return ONLY plain text (not JSON).
`;
  // Without an explicit directive DeepSeek drifted to German ~1/3 of the time on the en path.
  return args.language === "zh"
    ? CHINESE_WRAPPER(inner)
    : `${inner}\n\nWrite the entire analysis in English.`;
}

type IdeaGenerationArgs = {
  channelDescription: string;
  title: string;
  channelName: string;
  views: number;
  viralTrigger: string;
  numIdeas: number;
  language?: "en" | "zh";
  biblePositioning?: string;
  transcript?: string | null;
  direction?: string;
  sopReference?: string;
};

const IDEA_TRANSCRIPT_CHARS = 6000;
const SOP_REFERENCE_CHARS = 10_000;

export function buildIdeaGenerationPrompt(args: IdeaGenerationArgs): string {
  const biblePositioning = args.biblePositioning?.trim();
  const bibleBlock = biblePositioning
    ? `\n## Channel Positioning (Bible)\n${biblePositioning}\n\nEvery generated topic must fit this positioning — its target audience, voice/tone, and content direction. Drop any idea that contradicts it.\n`
    : "";
  const direction = args.direction?.trim();
  const directionBlock = direction
    ? `\n## User-Specified Topic Direction (HARD CONSTRAINTS)\n${direction}\n\nThese constraints come from the channel owner. Every idea MUST satisfy them; drop any idea that violates them — do not bend a constraint to keep an idea.\n`
    : "";
  const sopReference = args.sopReference?.trim();
  const sopBlock = sopReference
    ? `\n## Playbook Reference (the channel's SOP)\n${sopReference.slice(0, SOP_REFERENCE_CHARS)}\n\nAlign each idea with this playbook's proven patterns where they apply. For suggested_hook_type, reuse the EXACT hook names this SOP defines.\n`
    : "";
  const transcript = args.transcript?.trim();
  const transcriptBlock = transcript
    ? `\n## Source Video Transcript (grounding for facts you cite)\n${transcript.slice(0, IDEA_TRANSCRIPT_CHARS)}\n`
    : "";
  const inner = `You are a creative content strategist specializing in "Script Bending" — taking proven viral concepts and adapting them to a different niche.

## Target Channel
${args.channelDescription}
${bibleBlock}${directionBlock}${sopBlock}
## Source Video That Went Viral
- **Title:** ${args.title}
- **Channel:** ${args.channelName}
- **Views:** ${args.views.toLocaleString("en-US")} (may be a weighted engagement score, not raw plays, for XHS/Douyin sources)

## Viral Trigger Analysis
${args.viralTrigger}
${transcriptBlock}

## Instructions

Generate exactly ${args.numIdeas} UNIQUE content ideas for the target channel using the SAME viral trigger.

Rules:
1. Each idea must be a DIFFERENT topic.
2. Same viral MECHANISM but applied to the target niche.
3. Specific enough to start scripting immediately.
4. Include real facts, data points, or researchable claims.
5. Feel native to the target channel.
6. Vary the ANGLE TYPE across the batch — e.g. engineering deep-dive, myth-busting / expectation check, hands-on experiment, side-by-side comparison, data-driven story, prediction. At most 2 ideas may share an angle type, and story_angle phrasing must not repeat one sentence pattern across ideas.
7. Stay inside the target channel's niche — drop an idea rather than drift into adjacent lifestyle / marketing / general-interest territory.
8. Do NOT fabricate. Do not claim first-person experience, experiments, tests, or case-counts the channel hasn't actually done; do not invent statistics, sample sizes, prices, or dates. Prefer facts grounded in the source transcript above; you MAY add well-established public knowledge about the target niche (a product's launch year, a classic model's specs, a company's founder) when you are confident of it. Mark anything you are unsure of "(needs verification)" rather than omitting all specifics — an idea with no concrete facts is useless.
9. Quotes and events attributed to the SOURCE VIDEO must actually appear in its transcript/analysis above — do NOT put words in the source's mouth or invent a backstory it never mentions. (General niche knowledge under rule 8 is fine; fake source quotes are not.)
10. NEVER state that a named real person has died, is ill, committed wrongdoing, or said a specific quote unless the source explicitly says so — not even with "(needs verification)". A false death / scandal / quote about a real person or brand is a critical, potentially defamatory failure. If the source doesn't support it, omit the claim and keep the angle general (name no one).

Return JSON:
{
  "ideas": [
    {
      "story_angle": "Compelling working title capturing the viral hook.",
      "facts_and_data": "Several concrete, specific facts — statistics, numbers, names, dates, or researchable claims the script can build on. Be substantive, not a one-liner. Only include facts you can ground in the source; if unsure, describe the data point to verify and mark it (needs verification) — never fabricate specific numbers, dates, or names.",
      "why_similar": "One sentence on how this uses the same viral trigger.",
      "viral_trigger": "1-2 sentences on why THIS specific idea will spread — its own click / watch / share hook applied to this topic. Do NOT restate the source video's analysis; make it specific to this idea.",
      "cover_concept": "1-sentence visual concept for the thumbnail (subject, text overlay, emotion, color cue).",
      "suggested_hook_type": "Which of the channel's hook formulas to open with — reuse the exact hook name the channel/SOP already uses, in the channel's own language.",
      "risk_factors": "1-2 sentences flagging why this idea could underperform (sensitive topic, low search volume, dated reference, off-brand)."
    }
  ]
}

Return ONLY valid JSON. Generate exactly ${args.numIdeas} ideas.
`;
  if (args.language !== "zh") {
    return `${inner}\n\nWrite every field value in English.`;
  }
  return (
    CHINESE_WRAPPER(inner) +
    '\n\nIMPORTANT: JSON keys must remain in English (ideas, story_angle, facts_and_data, why_similar, viral_trigger, cover_concept, suggested_hook_type, risk_factors). Only the VALUES should be in Simplified Chinese.'
  );
}
