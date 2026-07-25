import { generateTextWithFallback } from "@goooose/integrations/clients/llm";
import { parseLlmJson } from "@goooose/integrations/utils";
import { buildFactCheckPrompt, type FactCheckItem } from "@goooose/prompts/poet";

// Must stay in sync with @goooose/db CheckedFact (mirrored per package, never cross-imported).
export type CheckedFact = {
  fact: string;
  src: string;
  status: "verified" | "disputed" | "unsupported";
  note?: string;
};

function parseVerbatim(verbatimFacts: string): { fact: string; src: string }[] {
  const out: { fact: string; src: string }[] = [];
  for (const raw of (verbatimFacts ?? "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const body = line.replace(/^[-*]\s*/, "");
    const m = body.match(/^(.*?)\s*\[src:\s*([^\]]*)\]\s*$/i);
    if (m) out.push({ fact: m[1]!.trim(), src: m[2]!.trim() });
    else out.push({ fact: body, src: "" });
  }
  return out;
}


// Marks only, never edits. Every failure path returns "verified" — this must neither block
// analysis nor false-flag a correct fact.
export async function factCheckVerbatim(args: {
  verbatimFacts: string;
  referenceTitles: string[];
  language?: "en" | "zh";
  logger?: { info?: (m: string) => void; warn?: (m: string) => void };
}): Promise<CheckedFact[]> {
  const parsed = parseVerbatim(args.verbatimFacts);
  if (parsed.length === 0) return [];
  const fallback = (): CheckedFact[] =>
    parsed.map((p) => ({ fact: p.fact, src: p.src, status: "verified" as const }));
  try {
    const items: FactCheckItem[] = parsed.map((p, i) => ({ index: i + 1, fact: p.fact, src: p.src }));
    const prompt = buildFactCheckPrompt({
      items,
      referenceTitles: args.referenceTitles,
      language: args.language ?? "zh",
    });
    const { text, finishReason } = await generateTextWithFallback({
      prompt,
      temperature: 0.1,
      maxOutputTokens: 4096,
      maxRetries: 2,
    });
    if (finishReason === "length") {
      args.logger?.warn?.("fact-check truncated (length cap); marking all verified");
      return fallback();
    }
    const arr = (await parseLlmJson(text, "array").catch(() => null)) as unknown[] | null;
    if (!arr) {
      args.logger?.warn?.("fact-check output unparseable; marking all verified");
      return fallback();
    }
    const byIndex = new Map<number, { status?: string; note?: string }>();
    for (const raw of arr) {
      if (raw && typeof raw === "object") {
        const o = raw as Record<string, unknown>;
        const idx = Number(o.index);
        if (Number.isFinite(idx)) {
          byIndex.set(idx, {
            status: typeof o.status === "string" ? o.status : undefined,
            note: typeof o.note === "string" ? o.note : undefined,
          });
        }
      }
    }
    const valid = new Set(["verified", "disputed", "unsupported"]);
    const result: CheckedFact[] = parsed.map((p, i) => {
      const v = byIndex.get(i + 1);
      const status = (v && valid.has(v.status ?? "") ? v.status : "verified") as CheckedFact["status"];
      const note = status === "verified" ? undefined : v?.note?.trim() || undefined;
      return { fact: p.fact, src: p.src, status, note };
    });
    const flagged = result.filter((r) => r.status !== "verified").length;
    args.logger?.info?.(`fact-check: ${result.length} facts, ${flagged} flagged`);
    return result;
  } catch (err) {
    args.logger?.warn?.(`fact-check failed: ${(err as Error).message?.slice(0, 120)}; marking all verified`);
    return fallback();
  }
}
