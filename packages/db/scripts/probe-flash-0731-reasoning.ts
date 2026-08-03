// The 0731 flash build emits reasoning tokens, which the old build did not. Every
// maxOutputTokens in the repo is a budget for reasoning + text combined, so this measures how
// much of it reasoning now takes on our REAL prompts, and whether text gets truncated as a result.
// Run: pnpm --filter @goooose/db exec tsx scripts/probe-flash-0731-reasoning.ts
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { generateText } from "ai";
import { isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { buildVideoAnalysisPrompt } from "@goooose/prompts/clerk";
import { llm } from "@goooose/integrations/clients/llm";
import { clerkVideos } from "../src/schema";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env.local") });
const client = postgres(process.env.DATABASE_URL!, { prepare: false });
const db = drizzle(client);

function parseAnalysis(text: string): Record<string, unknown> | null {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1]!.trim();
  try {
    return JSON.parse(t);
  } catch {}
  const s = t.indexOf("{");
  const e = t.lastIndexOf("}");
  if (s >= 0 && e > s) {
    try {
      return JSON.parse(t.slice(s, e + 1));
    } catch {}
  }
  return null;
}

type Row = {
  label: string;
  tier: string;
  budget: number;
  sec: number;
  completion: number;
  reasoning: number;
  pct: number;
  chars: number;
  finish: string;
  parseOk: boolean;
};
const rows: Row[] = [];

async function run(label: string, tier: "pro" | "flash", budget: number, prompt: string) {
  const t0 = Date.now();
  let text = "";
  let finish = "";
  let completion = 0;
  let reasoning = 0;
  try {
    const r = await generateText({
      model: llm(tier),
      prompt,
      maxOutputTokens: budget,
      temperature: 0.3,
      maxRetries: 1,
    });
    text = r.text ?? "";
    finish = r.finishReason ?? "";
    const u = r.usage as unknown as Record<string, number | undefined>;
    completion = Number(u?.outputTokens ?? u?.completionTokens ?? 0);
    reasoning = Number(u?.reasoningTokens ?? 0);
    // The SDK does not always surface reasoning tokens; fall back to the raw provider payload.
    if (!reasoning) {
      const pm = r.providerMetadata as unknown as Record<string, Record<string, unknown>> | undefined;
      const ds = pm?.deepseek as Record<string, unknown> | undefined;
      reasoning = Number(
        (ds?.reasoningTokens as number | undefined) ??
          ((ds?.completionTokensDetails as Record<string, number> | undefined)?.reasoning_tokens ?? 0),
      );
    }
  } catch (err) {
    finish = "ERR:" + (err as Error).message.slice(0, 60);
  }
  const sec = Math.round((Date.now() - t0) / 1000);
  const parsed = parseAnalysis(text);
  const pct = completion > 0 ? Math.round((reasoning / completion) * 100) : 0;
  rows.push({ label, tier, budget, sec, completion, reasoning, pct, chars: text.length, finish, parseOk: !!parsed });
  console.log(
    `  ${label.padEnd(22)} ${String(sec).padStart(3)}s  out=${String(completion).padStart(5)}  reasoning=${String(reasoning).padStart(5)} (${String(pct).padStart(3)}%)  text=${String(text.length).padStart(5)}ch  parse=${parsed ? "OK  " : "FAIL"}  finish=${finish}`,
  );
}

try {
  const vids = await db
    .select({ transcript: clerkVideos.transcript, title: clerkVideos.title })
    .from(clerkVideos)
    .where(isNotNull(clerkVideos.transcript));
  const pick = vids
    .filter((v) => (v.transcript?.length ?? 0) > 500)
    .sort((a, b) => (b.transcript!.length - a.transcript!.length))[0];
  if (!pick) throw new Error("no usable transcript in DB");
  const transcript = pick.transcript!.slice(0, 12000);

  const prompt = buildVideoAnalysisPrompt({
    title: pick.title,
    views: 1_000_000,
    durationSec: 180,
    thumbnailUrl: null,
    transcript,
    contentType: "xhs_video",
    language: "zh",
  });
  console.log(`real buildVideoAnalysisPrompt — transcript ${transcript.length} chars, prompt ${prompt.length} chars\n`);

  // Budgets we actually ship: 8192 is the A/B baseline, 4096 the tight one, 16384 the bible path.
  for (const budget of [4096, 8192, 16384]) {
    await run(`flash_${budget}`, "flash", budget, prompt);
  }
  await run("pro_8192", "pro", 8192, prompt);

  const flash = rows.filter((r) => r.tier === "flash" && r.completion > 0);
  if (flash.length) {
    const avg = Math.round(flash.reduce((s, r) => s + r.pct, 0) / flash.length);
    console.log(`\nflash reasoning share of output budget: avg ${avg}%  (per-run: ${flash.map((r) => r.pct + "%").join(", ")})`);
    console.log(`=> a maxOutputTokens of N now buys roughly ${100 - avg}% of N in actual text.`);
  }
  const truncated = rows.filter((r) => r.finish === "length");
  console.log(truncated.length ? `\nTRUNCATED: ${truncated.map((r) => r.label).join(", ")}` : "\nno run hit finishReason=length");
  const failed = rows.filter((r) => !r.parseOk);
  console.log(failed.length ? `PARSE FAILURES: ${failed.map((r) => r.label).join(", ")}` : "all runs produced parseable JSON");
} finally {
  await client.end();
}
