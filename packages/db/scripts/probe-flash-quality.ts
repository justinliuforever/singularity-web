// Reliability is not enough: turning reasoning off could make the output worse. Scores the real
// video-analysis JSON on the same axes the earlier A/B used — parseability, 15-key completeness,
// and field depth — for flash (thinking off) vs pro. Run with RUNS=3.
import { resolve } from "node:path";
import dotenv from "dotenv";
import { generateText } from "ai";
import { isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { buildVideoAnalysisPrompt } from "@goooose/prompts/clerk";
import { llm } from "@goooose/integrations/clients/llm";
import { clerkVideos } from "../src/schema";

dotenv.config({ path: resolve(import.meta.dirname, "../../../.env.local") });
const client = postgres(process.env.DATABASE_URL!, { prepare: false });
const db = drizzle(client);
const RUNS = Number(process.env.RUNS ?? 3);

const KEYS = ["thumbnail_description","thumbnail_why_it_works","opening_hook","opening_hook_type","hooks_throughout","all_hook_types","text_hook","framework","opening_structure","script_structure","storytelling_framework","rehooks_used","retention_pattern","cta_placement","key_takeaways"];

function parse(t: string): Record<string, unknown> | null {
  let s = t.trim();
  const f = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (f) s = f[1]!.trim();
  try { return JSON.parse(s); } catch {}
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch {} }
  return null;
}

async function score(tier: "flash" | "pro", prompt: string) {
  const rows: Array<{ ok: boolean; keys: number; depth: number; sec: number; out: number }> = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = Date.now();
    try {
      const r = await generateText({ model: llm(tier), prompt, maxOutputTokens: 16384, temperature: 0.3, maxRetries: 0 });
      const u = r.usage as unknown as Record<string, number | undefined>;
      const p = parse(r.text ?? "");
      const keys = p ? KEYS.filter((k) => p[k] && String(p[k]).trim().length > 0).length : 0;
      // Depth = mean chars per filled field; a model that answers in stubs scores low.
      const depth = p ? Math.round(KEYS.reduce((s, k) => s + String(p[k] ?? "").length, 0) / Math.max(keys, 1)) : 0;
      const sec = Math.round((Date.now() - t0) / 1000);
      rows.push({ ok: !!p, keys, depth, sec, out: Number(u?.outputTokens ?? 0) });
      console.log(`  ${tier.padEnd(5)} [${i + 1}] ${String(sec).padStart(3)}s  parse=${p ? "OK  " : "FAIL"}  keys=${String(keys).padStart(2)}/15  depth=${String(depth).padStart(4)}ch  out=${u?.outputTokens}`);
    } catch (err) {
      console.log(`  ${tier.padEnd(5)} [${i + 1}] ERR ${(err as Error).message.slice(0, 60)}`);
      rows.push({ ok: false, keys: 0, depth: 0, sec: 0, out: 0 });
    }
  }
  const good = rows.filter((r) => r.ok);
  const avg = (f: (r: (typeof rows)[number]) => number) => good.length ? Math.round(good.reduce((s, r) => s + f(r), 0) / good.length) : 0;
  return { tier, hit: `${good.length}/${RUNS}`, keys: avg((r) => r.keys), depth: avg((r) => r.depth), sec: avg((r) => r.sec), out: avg((r) => r.out) };
}

try {
  const vids = await db.select({ t: clerkVideos.transcript, ti: clerkVideos.title, v: clerkVideos.views, d: clerkVideos.durationSec })
    .from(clerkVideos).where(isNotNull(clerkVideos.transcript));
  const w = vids.filter((x) => (x.t?.length ?? 0) > 300).sort((a, b) => b.t!.length - a.t!.length);
  const mid = w[Math.floor(w.length / 2)]!;
  const prompt = buildVideoAnalysisPrompt({
    title: mid.ti, views: mid.v ?? 1000, durationSec: mid.d ?? 180, thumbnailUrl: null,
    transcript: mid.t!, contentType: "xhs_video", language: "zh",
  });
  console.log(`quality A/B on the real analysis prompt (${prompt.length}ch), ${RUNS} runs each\n`);
  const f = await score("flash", prompt);
  const p = await score("pro", prompt);
  console.log("\n============ QUALITY ============");
  console.log(`  tier   hit   keys/15  depth   sec   outTokens`);
  for (const r of [f, p]) console.log(`  ${r.tier.padEnd(6)} ${r.hit}   ${String(r.keys).padStart(5)}   ${String(r.depth).padStart(4)}ch  ${String(r.sec).padStart(4)}  ${r.out}`);
  const verdict = f.keys >= p.keys - 1 && f.depth >= p.depth * 0.7
    ? "flash (thinking off) matches pro on completeness — safe to keep flash"
    : "flash is materially thinner than pro — move the heavy paths to pro";
  console.log(`\n=> ${verdict}`);
} finally { await client.end(); }
