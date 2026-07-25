import { generateText } from "ai";

import { generateTextWithFallback, llm } from "@goooose/integrations/clients/llm";

// Returns the original draft on empty / truncation / error — never breaks the run.
export async function redactUngrounded(args: {
  draft: string;
  source: string;
  language?: "en" | "zh";
  mode?: "doc" | "script";
  tier?: "flash" | "fallback";
  maxOutputTokens?: number;
  logger?: { info?: (m: string) => void; warn?: (m: string) => void };
}): Promise<string> {
  const draft = (args.draft ?? "").trim();
  if (!draft) return args.draft;
  const tag = (args.language ?? "zh") === "zh" ? "「待核实」" : "[unverified]";
  const isScript = args.mode === "script";
  // Script mode keeps stable public knowledge — redacting it gutted the specificity scripts need.
  const fixRule = isScript
    ? `judge it by tier:
  (a) STABLE public knowledge — a fact that has sat unchanged in public records for years (a product's launch year, a company's founder, a classic model's specs) — and you are HIGHLY confident of it → keep it;
  (b) TIME-SENSITIVE or private specifics (current prices, sales or view counts, inventory, anyone's recent statements or activities) → rewrite into natural, general spoken wording, or drop it — even if you believe you know the value. This text is READ ALOUD — do NOT insert ${tag} or any bracketed note; the result must be speakable;
  (c) a NEGATIVE claim about a real person (death, illness, wrongdoing, or a specific line attributed to them) → drop it entirely, no exceptions.`
    : `make the smallest fix: replace the exact figure/name with a general phrasing, drop the false precision, or mark it ${tag}.`;
  const emptyRule = isScript
    ? `If the SOURCE is empty or has no concrete data, apply the same tiers: keep only STABLE public knowledge you are HIGHLY confident of; every other specific price / spec / stat / named product / quote must be generalized into natural spoken wording (never insert ${tag}).`
    : `If the SOURCE is empty or has no concrete data, the DRAFT must end up with NO specific prices / specs / stats / named products / quotes — generalize or ${tag} all of them (strategy-level wording is fine).`;
  // Section markers are what the UI splits on, and a heavy rewrite was dropping them.
  const markerRule = isScript
    ? `\n- This is a sectioned script: keep EVERY structural marker ([HOOK], [TEASE], [ITEM 1], [ITEM 2], [CLIMAX], [CTA], [CLOSE], …) exactly where it is, on its own line. They are structure, not factual claims — never drop, merge, move, or reword a marker.`
    : "";
  const prompt = `You are a strict fact-checker and copy-cleaner. You are given SOURCE MATERIAL (the ground truth) and a DRAFT generated from it. Your job is to make the DRAFT factually safe — remove fabricated specifics, clean garbled source quotes, and fix clear factual errors — WITHOUT rewriting its structure, voice, or grounded content.

Go through the DRAFT. For every SPECIFIC factual claim — price, number, percentage, statistic, measurement or spec, model / product / brand name, person name, social handle, date or year, a named domain-specific technique detail (e.g. an anatomical structure, injection site / landmark, tool setting), a stated ORDER of steps in a named method, a self-test that routes the reader to a decision, and any line presented as a verbatim quote — decide:
- SOURCE supports it → keep it exactly.
- SOURCE does NOT support it → ${fixRule} A quoted line not found in the SOURCE must not be presented as a real quote.${isScript ? "" : " Never leave an unsupported specific stated as fact."}
- GARBLED ASR in the SOURCE → never reproduce a nonsensical garbled quote / number / name (e.g. "六年两百九十三个零件", "新一4.4百币"); correct it from context if the intent is clear, otherwise drop it${isScript ? "" : ` or mark ${tag}`}.
- STEP ORDER: if the SOURCE states a numbered or explicit order for a process, the DRAFT must not reorder those steps — fix the DRAFT's order to match the SOURCE.
- CLEAR FACTUAL ERROR about a real, widely-known entity (e.g. a wrong launch year for a famous product, a misattributed quote) → if you are HIGHLY confident of the correct value, fix it to the correct value; if unsure, do not guess${isScript ? ", soften to safe general wording" : ` — mark it ${tag}`}.

Always allowed (never redact these): the channel's own name, the host's name, and the channel/show brand — they identify the deliverable, not a factual claim.

Hard rules:
- Preserve the DRAFT's language, structure, section headers, voice, and every grounded sentence unchanged. Touch ONLY unsupported specifics, garbled source quotes, and clear factual errors.${markerRule}
- Do NOT add new facts, sections, analysis, or commentary. Do NOT explain your edits or wrap the output in code fences.
- ${emptyRule}
- Output ONLY the corrected document.

## SOURCE MATERIAL
${args.source?.trim() || "(none provided — treat ALL specific figures, specs, names, and quotes in the draft as unsupported)"}

## DRAFT
${draft}`;
  try {
    // Flash by default: redaction is mechanical and a reasoning model truncates long docs.
    // tier:"fallback" (Pro-first) is only safe on short drafts, where Pro catches factual errors.
    const maxOutputTokens = args.maxOutputTokens ?? 16384;
    let out: string;
    let finishReason: string | undefined;
    if (args.tier === "fallback") {
      const r = await generateTextWithFallback({ prompt, maxOutputTokens, temperature: 0.2 });
      out = r.text.trim();
      finishReason = r.finishReason;
    } else {
      const r = await generateText({ model: llm("flash"), prompt, maxOutputTokens, temperature: 0.2, maxRetries: 2 });
      out = r.text.trim();
      finishReason = r.finishReason;
    }
    if (!out) {
      args.logger?.warn?.("grounding pass returned empty; keeping draft");
      return args.draft;
    }
    // Un-redacted but complete beats truncated.
    if (finishReason === "length") {
      args.logger?.warn?.(`grounding pass truncated (length cap); keeping original draft`);
      return args.draft;
    }
    // Intermittent over-redaction can gut the draft (seen 0.16×); normal redaction removes well under 40%.
    if (out.length < draft.length * 0.6) {
      args.logger?.warn?.(`grounding pass shrank ${draft.length}→${out.length} (<0.6x); keeping draft`);
      return args.draft;
    }
    args.logger?.info?.(`grounding pass: ${draft.length} → ${out.length} chars`);
    return out;
  } catch (err) {
    args.logger?.warn?.(`grounding pass failed: ${(err as Error).message?.slice(0, 120)}; keeping draft`);
    return args.draft;
  }
}
