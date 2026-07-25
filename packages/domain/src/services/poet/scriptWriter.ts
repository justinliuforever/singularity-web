import { generateText } from "ai";

import { generateTextWithFallback, llm } from "@goooose/integrations/clients/llm";
import { parseLlmJson } from "@goooose/integrations/utils";
import { redactUngrounded } from "../grounding";
import {
  buildLongFormOutlinePrompt,
  buildScriptCompressPrompt,
  buildScriptExpandPrompt,
  buildScriptWritingPrompt,
  buildSectionExpandPrompt,
} from "@goooose/prompts/poet";
import { countWords, isLongForm } from "../../schemas/poet";
import { selectBibleSections } from "./bible";
import type { CheckedFact } from "./factCheck";
import { humanizeChinese } from "./humanizer";

const MAX_REFERENCE_CHARS = 24000;
const MAX_SECTION_REFERENCE_CHARS = 10000;
const PREV_TAIL_CHARS = 400;
const OVERSHOOT_LIMIT = 1.2;

export type ScriptReference = {
  type?: string;
  title?: string;
  url?: string;
  content?: string;
  error?: string;
};

export function formatReferencesBlock(
  references: ScriptReference[] | null | undefined,
  maxChars = MAX_REFERENCE_CHARS,
): string {
  if (!references || references.length === 0) {
    return "(No external references attached.)";
  }
  const parts: string[] = [];
  for (let i = 0; i < references.length; i++) {
    const ref = references[i]!;
    const refType = ref.type ?? "unknown";
    const title = ref.title || `Reference ${i + 1}`;
    const url = ref.url ?? "";
    const original = ref.content ?? "";
    const urlLine = url ? `\n- URL: ${url}` : "";
    if (!original.trim()) {
      const errorMsg = ref.error ?? "transcript unavailable";
      parts.push(
        `### Reference ${i + 1} (${refType}): ${title}${urlLine}\n\n[FETCH FAILED — ${errorMsg}. Do not invent content for this reference.]\n`,
      );
      continue;
    }
    const content =
      original.length > maxChars
        ? `${original.slice(0, maxChars)}\n…[truncated — original was ${original.length} chars]`
        : original;
    parts.push(
      `### Reference ${i + 1} (${refType}): ${title}${urlLine}\n\n${content}\n`,
    );
  }
  return parts.join("\n");
}

export function formatVerbatimFacts(
  verbatimFacts: string | null | undefined,
  factChecks?: CheckedFact[] | null,
): string {
  const flagged = (factChecks ?? []).filter((f) => f.status !== "verified");
  if (flagged.length > 0) {
    return (factChecks ?? [])
      .map((f) => {
        const base = `- ${f.fact}${f.src ? ` [src: ${f.src}]` : ""}`;
        if (f.status === "verified") return base;
        const why = f.note?.trim() || "conflicts with well-known facts";
        return `${base}  ⚠️ DISPUTED — ${why}; do NOT state this specific value as fact (generalize it or omit the number/year)`;
      })
      .join("\n");
  }
  const text = (verbatimFacts ?? "").trim();
  if (!text) {
    return "(No verbatim facts extracted. Pull all specific data directly from the References above and copy exactly.)";
  }
  return text;
}

export type IdeaInput = {
  storyAngle: string;
  factsAndData: string;
  whySimilar: string;
  viralTrigger: string;
  sourceTitle: string;
  sourceChannel: string;
};

export type WriteScriptArgs = {
  idea: IdeaInput;
  sopText: string;
  bibleText: string;
  language: "zh" | "en";
  references?: ScriptReference[] | null;
  targetWordCount: number;
  verbatimFacts?: string | null;
  factChecks?: CheckedFact[] | null;
  // Anchors speaker identity so the SOP's source creator never becomes the persona.
  channelName?: string;
  // Bible-declared host (imported persona docs): allowed self-name beyond channelName.
  hostName?: string | null;
  // Extra grounding-only source (import transcript) — never enters the writing prompt.
  groundingSource?: string | null;
};

export type ScriptResult = {
  scriptText: string;
  wordCount: number;
};

export type OutlineSection = {
  marker: string;
  key_points: string[];
  target_count: number;
  emotional_note: string;
};

export type Outline = {
  overall_arc: string;
  sections: OutlineSection[];
};


function normalizeOutline(parsed: unknown, fallbackTargetCount: number, targetTotal: number): Outline | null {
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  const rawSections = obj.sections;
  if (!Array.isArray(rawSections) || rawSections.length === 0) return null;
  const sections: OutlineSection[] = [];
  for (const s of rawSections) {
    if (!s || typeof s !== "object") continue;
    const sec = s as Record<string, unknown>;
    const marker = typeof sec.marker === "string" ? sec.marker : null;
    if (!marker) continue;
    const keyPointsRaw = Array.isArray(sec.key_points) ? sec.key_points : [];
    const keyPoints = keyPointsRaw.map((p) => String(p));
    const targetCount =
      typeof sec.target_count === "number" && sec.target_count > 0
        ? Math.round(sec.target_count)
        : fallbackTargetCount;
    const emotionalNote = typeof sec.emotional_note === "string" ? sec.emotional_note : "";
    sections.push({
      marker,
      key_points: keyPoints,
      target_count: targetCount,
      emotional_note: emotionalNote,
    });
  }
  if (sections.length === 0) return null;
  const sum = sections.reduce((a, s) => a + s.target_count, 0);
  if (sum > 0 && (sum < targetTotal * 0.8 || sum > targetTotal * OVERSHOOT_LIMIT)) {
    const scale = targetTotal / sum;
    for (const s of sections) s.target_count = Math.round(s.target_count * scale);
  }
  return {
    overall_arc: typeof obj.overall_arc === "string" ? obj.overall_arc : "",
    sections,
  };
}

export type LongFormHooks = {
  onOutlineDone?: (outline: Outline) => void | Promise<void>;
  onSectionStart?: (info: { index: number; total: number; marker: string }) => void | Promise<void>;
  onSectionDone?: (info: { index: number; total: number; marker: string; chars: number }) => void | Promise<void>;
  onHumanizeStart?: () => void | Promise<void>;
};

async function writeScriptLong(
  args: WriteScriptArgs,
  hooks: LongFormHooks = {},
): Promise<ScriptResult | null> {
  const language = args.language;
  const targetWordCount = args.targetWordCount;
  const ideaText =
    `Story Angle: ${args.idea.storyAngle}\n\n` +
    `Facts & Data: ${args.idea.factsAndData}\n\n` +
    `Why Similar: ${args.idea.whySimilar}`;
  const refsBlockFull = formatReferencesBlock(args.references, MAX_REFERENCE_CHARS);
  const refsBlockSection = formatReferencesBlock(args.references, MAX_SECTION_REFERENCE_CHARS);
  const verbatimBlock = formatVerbatimFacts(args.verbatimFacts, args.factChecks);

  const outlinePrompt = buildLongFormOutlinePrompt({
    sopReference: args.sopText,
    referencesContext: refsBlockFull,
    ideaText,
    viralTrigger: args.idea.viralTrigger,
    targetWordCount,
    language,
  });

  const outlineResult = await generateText({
    model: llm("pro"),
    prompt: outlinePrompt,
    temperature: 0.5,
    maxOutputTokens: 8192,
    maxRetries: 2,
  });

  const lengthUnit = language === "zh" ? "characters (字)" : "words";
  const outline = normalizeOutline(
    await parseLlmJson(outlineResult.text),
    Math.max(200, Math.round(targetWordCount / 5)),
    targetWordCount,
  );
  if (!outline) {
    // eslint-disable-next-line no-console
    console.warn(
      "[poet:long-form] outline parse failed, falling back to short-form. Head:",
      outlineResult.text.slice(0, 300),
    );
    return null;
  }

  await hooks.onOutlineDone?.(outline);

  const outlineSummary = outline.sections
    .map(
      (s) =>
        `  ${s.marker}: ${(s.key_points.slice(0, 2).join("; ") || "(see arc)").trim()} (~${s.target_count} ${lengthUnit})`,
    )
    .join("\n");

  const charsPerToken = language === "zh" ? 1.5 : 0.75;
  const scriptParts: string[] = [];
  let prevTail = "(This is the opening section — start strong.)";
  let emptyCount = 0;

  for (let idx = 0; idx < outline.sections.length; idx++) {
    const section = outline.sections[idx]!;
    await hooks.onSectionStart?.({
      index: idx,
      total: outline.sections.length,
      marker: section.marker,
    });

    const keyPointsBlock =
      section.key_points.length > 0
        ? section.key_points.map((p) => `- ${p}`).join("\n")
        : "- (follow the outline arc)";

    // 3000-token floor: short sections (HOOK/CTA/CLOSE) returned empty when reasoning ate the budget.
    const sectionMaxTokens = Math.max(
      3000,
      Math.min(Math.round((section.target_count / charsPerToken) * 2.0) + 500, 6144),
    );

    const expandPrompt = buildSectionExpandPrompt({
      language,
      sopReference: args.sopText,
      referencesContext: refsBlockSection,
      verbatimFactsContext: verbatimBlock,
      overallArc: outline.overall_arc,
      outlineSummary,
      prevTail,
      marker: section.marker,
      keyPoints: keyPointsBlock,
      targetCount: section.target_count,
      emotionalNote: section.emotional_note,
      channelName: args.channelName,
      hostName: args.hostName,
    });

    let sectionText = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const sectionResult = await generateText({
        model: llm("pro"),
        prompt: expandPrompt,
        temperature: 0.5,
        maxOutputTokens: sectionMaxTokens,
        maxRetries: 2,
      });
      sectionText = sectionResult.text.trim();
      if (sectionText.length > 0) break;
      // eslint-disable-next-line no-console
      console.warn(
        `[poet:long-form] empty section ${section.marker} on attempt ${attempt + 1}, retrying`,
      );
    }
    if (sectionText.length === 0) {
      // Pro intermittently empties a section (reasoning ate the budget); Flash usually fills it.
      const flash = await generateText({
        model: llm("flash"),
        prompt: expandPrompt,
        temperature: 0.5,
        maxOutputTokens: sectionMaxTokens,
        maxRetries: 2,
      });
      sectionText = flash.text.trim();
    }

    if (sectionText.length === 0) {
      // eslint-disable-next-line no-console
      console.warn(`[poet:long-form] section ${section.marker} empty after Pro+Flash`);
      // No opening → single-call fallback; any other stuck section is skipped, not aborted.
      if (idx === 0) return null;
      emptyCount++;
      if (emptyCount > Math.ceil(outline.sections.length / 3)) {
        // eslint-disable-next-line no-console
        console.warn(`[poet:long-form] ${emptyCount} empty sections; falling back to single-call`);
        return null;
      }
      continue;
    }

    scriptParts.push(`${section.marker}\n${sectionText}`);
    prevTail = sectionText.length > PREV_TAIL_CHARS ? sectionText.slice(-PREV_TAIL_CHARS) : sectionText;

    await hooks.onSectionDone?.({
      index: idx,
      total: outline.sections.length,
      marker: section.marker,
      chars: sectionText.length,
    });
  }

  let scriptText = scriptParts.join("\n\n");
  let wordCount = countWords(scriptText, language);
  // Sections routinely under-deliver; deepen once, the gate trims any overshoot.
  if (wordCount < targetWordCount * 0.8) {
    const grown = await expandToBudget(scriptText, wordCount, {
      language,
      targetWordCount,
      referencesContext: refsBlockSection,
    });
    scriptText = grown.scriptText;
    wordCount = grown.wordCount;
  }
  return { scriptText, wordCount };
}

async function expandToBudget(
  scriptText: string,
  wordCount: number,
  args: Pick<WriteScriptArgs, "language" | "targetWordCount"> & { referencesContext: string },
): Promise<ScriptResult> {
  const floor = Math.round(args.targetWordCount * 0.85);
  const ceiling = Math.round(args.targetWordCount * 1.5);
  let bestText = scriptText;
  let bestCount = wordCount;
  for (let attempt = 0; attempt < 3 && bestCount < floor; attempt++) {
    const expanded = await generateTextWithFallback({
      prompt: buildScriptExpandPrompt({
        scriptText: bestText,
        language: args.language,
        targetWordCount: args.targetWordCount,
        referencesContext: args.referencesContext,
      }),
      temperature: 0.5,
      maxOutputTokens: 16384,
      maxRetries: 2,
    });
    const et = expanded.text.trim();
    const ec = countWords(et, args.language);
    // Overgrown expansions are still progress — the compress gate trims them back.
    if (ec > ceiling && ec > bestCount) {
      bestText = et;
      bestCount = ec;
      break;
    }
    if (!et || expanded.finishReason === "length" || ec <= bestCount) {
      // eslint-disable-next-line no-console
      console.warn(
        `[poet:expand] attempt ${attempt + 1} unusable (finish=${expanded.finishReason}, count=${ec}/${bestCount}); retrying`,
      );
      continue;
    }
    bestText = et;
    bestCount = ec;
  }
  return { scriptText: bestText, wordCount: bestCount };
}

export async function writeScript(
  args: WriteScriptArgs,
  hooks: LongFormHooks = {},
): Promise<ScriptResult & { path: "short" | "long"; humanized: boolean }> {
  let result: ScriptResult & { path: "short" | "long" };
  if (isLongForm(args.targetWordCount, args.language)) {
    const long = await writeScriptLong(args, hooks);
    if (long) result = { ...long, path: "long" };
    else {
      const short = await writeScriptShort(args);
      result = { ...short, path: "short" };
    }
  } else {
    const short = await writeScriptShort(args);
    result = { ...short, path: "short" };
  }

  // No post-hoc Bible-quote injection: it forced irrelevant lines into the hook.

  const source = [
    args.bibleText,
    args.groundingSource ?? "",
    formatReferencesBlock(args.references),
    formatVerbatimFacts(args.verbatimFacts, args.factChecks),
    args.idea.factsAndData,
  ].join("\n\n");
  const grounded = await redactUngrounded({
    draft: result.scriptText,
    source,
    language: args.language,
    mode: "script",
    tier: "fallback", // Pro-first: catches factual errors (e.g. wrong product year) a script asserts.
  });
  if (grounded && grounded !== result.scriptText) {
    result = { ...result, scriptText: grounded, wordCount: countWords(grounded, args.language) };
  }

  // enforceBudget must stay AFTER this: humanizing can inflate the text past the window.
  let humanized = false;
  if (args.language === "zh") {
    await hooks.onHumanizeStart?.();
    const rewritten = (
      await humanizeChinese(result.scriptText, Math.round(args.targetWordCount * OVERSHOOT_LIMIT))
    ).trim();
    if (rewritten && rewritten !== result.scriptText) {
      result = { ...result, scriptText: rewritten, wordCount: countWords(rewritten, args.language) };
    }
    humanized = true;
  }

  result = await enforceBudget(result, {
    ...args,
    referencesContext: formatReferencesBlock(args.references),
  });

  // Deterministic backstop: the writer still occasionally signs off as the ANALYZED creator.
  const scrubbed = scrubForeignSelfIntro(result.scriptText, args);
  if (scrubbed !== result.scriptText) {
    result = { ...result, scriptText: scrubbed, wordCount: countWords(scrubbed, args.language) };
  }

  return { ...result, humanized };
}

export function scrubForeignSelfIntro(scriptText: string, args: Pick<WriteScriptArgs, "channelName" | "hostName" | "bibleText" | "sopText" | "language">): string {
  const channelName = (args.channelName ?? "").trim();
  const hostName = (args.hostName ?? "").trim();
  const sources = `${args.bibleText}\n${args.sopText}`;
  const pattern =
    args.language === "zh"
      ? /我是([\p{Script=Han}A-Za-z][\p{Script=Han}A-Za-z0-9]{1,7})/gu
      : /I(?:'m| am) ([A-Z][A-Za-z]{1,15})/g;
  return scriptText.replace(pattern, (full, name: string) => {
    if (!name || name === channelName) return full;
    if (channelName && channelName.includes(name)) return full;
    if (hostName && (name === hostName || hostName.includes(name))) return full;
    // Only a name that exists in the analyzed sources is a persona leak.
    if (!sources.includes(name)) return full;
    if (channelName) return args.language === "zh" ? `我是${channelName}` : full.replace(name, channelName);
    return args.language === "zh" ? "我" : "I";
  });
}

async function enforceBudget(
  result: ScriptResult & { path: "short" | "long" },
  args: Pick<WriteScriptArgs, "language" | "targetWordCount"> & { referencesContext: string },
): Promise<ScriptResult & { path: "short" | "long" }> {
  if (result.wordCount > args.targetWordCount * OVERSHOOT_LIMIT) {
    const squeezed = await compressToBudget(result.scriptText, result.wordCount, args);
    return { ...result, ...squeezed };
  }
  if (result.wordCount < args.targetWordCount * 0.8) {
    const grown = await expandToBudget(result.scriptText, result.wordCount, args);
    // Compress accepts anything ≥0.5x, so it can undershoot badly — keep whichever lands closest.
    if (grown.wordCount > args.targetWordCount * OVERSHOOT_LIMIT) {
      const squeezed = await compressToBudget(grown.scriptText, grown.wordCount, args);
      const best =
        Math.abs(squeezed.wordCount - args.targetWordCount) <=
        Math.abs(grown.wordCount - args.targetWordCount)
          ? squeezed
          : grown;
      return { ...result, ...best };
    }
    return { ...result, ...grown };
  }
  return result;
}

export async function writeScriptShort(args: WriteScriptArgs): Promise<ScriptResult> {
  const ideaText =
    `Story Angle: ${args.idea.storyAngle}\n\n` +
    `Facts & Data: ${args.idea.factsAndData}\n\n` +
    `Why Similar: ${args.idea.whySimilar}`;

  const prompt = buildScriptWritingPrompt({
    // Script needs identity + rules + methodology; sources/topic-framework are ideation noise here.
    channelBible: selectBibleSections(args.bibleText, ["POSITIONING", "PERSONA", "CONTENT_RULES", "METHODOLOGY"]),
    sopReference: args.sopText,
    referencesContext: formatReferencesBlock(args.references),
    verbatimFactsContext: formatVerbatimFacts(args.verbatimFacts, args.factChecks),
    sourceTitle: args.idea.sourceTitle,
    sourceChannel: args.idea.sourceChannel,
    viralTrigger: args.idea.viralTrigger,
    ideaText,
    language: args.language,
    targetWordCount: args.targetWordCount,
    channelName: args.channelName,
  });

  const result = await generateText({
    model: llm("pro"),
    prompt,
    temperature: 0.5,
    // Reasoning tokens draw from this budget too.
    maxOutputTokens: 16384,
    maxRetries: 2,
  });

  const scriptText = result.text;
  const wordCount = countWords(scriptText, args.language);

  return { scriptText, wordCount };
}

async function compressToBudget(
  scriptText: string,
  wordCount: number,
  args: Pick<WriteScriptArgs, "language" | "targetWordCount">,
): Promise<ScriptResult> {
  const ceiling = Math.round(args.targetWordCount * OVERSHOOT_LIMIT);
  const floor = Math.round(args.targetWordCount * 0.5);
  const charsPerToken = args.language === "zh" ? 1.5 : 0.75;
  // Retries escalate the token budget — reasoning can eat a tight cap and return empty.
  const baseOutputTokens = Math.round((ceiling / charsPerToken) * 1.4) + 800;
  let bestText = scriptText;
  let bestCount = wordCount;
  for (let attempt = 0; attempt < 3 && bestCount > ceiling; attempt++) {
    // Pro-first: Flash alone deadlocks thinking on this prompt (empty text at any budget).
    const compressed = await generateTextWithFallback({
      prompt: buildScriptCompressPrompt({
        scriptText: bestText,
        language: args.language,
        targetWordCount: args.targetWordCount,
      }),
      temperature: 0.3,
      maxOutputTokens: Math.min(16384, baseOutputTokens + attempt * 6144),
      maxRetries: 2,
    });
    const ct = compressed.text.trim();
    const cc = countWords(ct, args.language);
    if (!ct || compressed.finishReason === "length" || cc < floor) {
      // eslint-disable-next-line no-console
      console.warn(
        `[poet:compress] attempt ${attempt + 1} unusable (finish=${compressed.finishReason}, count=${cc}); retrying`,
      );
      continue;
    }
    if (cc < bestCount) {
      bestText = ct;
      bestCount = cc;
    }
  }
  return { scriptText: bestText, wordCount: bestCount };
}
