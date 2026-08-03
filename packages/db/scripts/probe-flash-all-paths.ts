// Every production path that calls llm("flash"), exercised with its REAL prompt builder and its
// REAL maxOutputTokens, against real rows. The 0731 build turned flash into a reasoning model, so
// each path is scored on whether it still returns text at all.
// Run: pnpm --filter @goooose/db exec tsx scripts/probe-flash-all-paths.ts
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { generateText } from "ai";
import { isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { buildClassificationPrompt, buildIdeaGenerationPrompt } from "@goooose/prompts/muse";
import { buildSeriesDetectPrompt } from "@goooose/prompts/clerk-series";
import { buildCommentsSummaryPrompt } from "@goooose/prompts/clerk-comments";
import { buildVideoAnalysisPrompt } from "@goooose/prompts/clerk";
import { buildChannelBiblePrompt } from "@goooose/prompts/poet";
import { llm } from "@goooose/integrations/clients/llm";
import { clerkVideos } from "../src/schema";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env.local") });
const client = postgres(process.env.DATABASE_URL!, { prepare: false });
const db = drizzle(client);

const RUNS = Number(process.env.RUNS ?? 2);

type Result = { path: string; budget: number; tier: string; ok: number; runs: number; notes: string[] };
const results: Result[] = [];

async function score(path: string, budget: number, tier: "flash" | "pro", prompt: string, runs = RUNS) {
  const notes: string[] = [];
  let ok = 0;
  for (let i = 0; i < runs; i++) {
    const t0 = Date.now();
    try {
      const r = await generateText({ model: llm(tier), prompt, maxOutputTokens: budget, temperature: 0.3, maxRetries: 0 });
      const u = r.usage as unknown as Record<string, number | undefined>;
      const text = (r.text ?? "").trim();
      if (text.length > 0 && r.finishReason !== "length") ok++;
      notes.push(
        `${Math.round((Date.now() - t0) / 1000)}s out=${u?.outputTokens ?? "?"} reasoning=${u?.reasoningTokens ?? "?"} text=${text.length}ch ${r.finishReason}`,
      );
    } catch (err) {
      notes.push(`ERR ${(err as Error).message.slice(0, 50)}`);
    }
  }
  results.push({ path, budget, tier, ok, runs, notes });
  const bar = ok === runs ? "PASS" : ok === 0 ? "DEAD" : "FLAKY";
  console.log(`  ${bar}  ${path.padEnd(26)} ${tier.padEnd(5)} budget=${String(budget).padStart(5)}  ${ok}/${runs}`);
  for (const n of notes) console.log(`         ${n}`);
  return ok;
}

try {
  const vids = await db
    .select({ transcript: clerkVideos.transcript, title: clerkVideos.title, views: clerkVideos.views, durationSec: clerkVideos.durationSec })
    .from(clerkVideos)
    .where(isNotNull(clerkVideos.transcript));
  const withText = vids.filter((v) => (v.transcript?.length ?? 0) > 300);
  const big = withText.sort((a, b) => b.transcript!.length - a.transcript!.length)[0]!;
  // A median-sized row is the honest default; the largest one is the worst case.
  const mid = withText[Math.floor(withText.length / 2)]!;
  console.log(`corpus: ${withText.length} transcripts; median ${mid.transcript!.length}ch, largest ${big.transcript!.length}ch\n`);

  // 1. clerk video analysis — analyze-channel.ts:632, budget 16384
  const analysisPrompt = buildVideoAnalysisPrompt({
    title: mid.title, views: mid.views ?? 1000, durationSec: mid.durationSec ?? 180,
    thumbnailUrl: null, transcript: mid.transcript!, contentType: "xhs_video", language: "zh",
  });
  await score("clerk video analysis", 16384, "flash", analysisPrompt);

  // 2. muse classify — muse.ts:45, budget 1500 (known-good control)
  const classifyPrompt = buildClassificationPrompt({
    channelDescription: "面向中国小型创作者的 AI 内容教练", title: mid.title,
    channelName: "对标账号", views: mid.views ?? 1000, durationSec: mid.durationSec ?? 180,
    transcriptPreview: mid.transcript!.slice(0, 2000), language: "zh",
  } as Parameters<typeof buildClassificationPrompt>[0]);
  await score("muse classify", 1500, "flash", classifyPrompt);

  // 3. muse idea generation — the second LLM call per row
  const ideaPrompt = buildIdeaGenerationPrompt({
    channelDescription: "面向中国小型创作者的 AI 内容教练", title: mid.title,
    channelName: "对标账号", views: mid.views ?? 1000, viralTrigger: "开场三秒抛出反直觉结论",
    numIdeas: 5, language: "zh", transcript: mid.transcript!.slice(0, 3000),
  } as Parameters<typeof buildIdeaGenerationPrompt>[0]);
  await score("muse idea generation", 4096, "flash", ideaPrompt);

  // 4. series detection — detect-channel-series.ts:106, budget 8000
  const seriesPrompt = buildSeriesDetectPrompt({
    channelName: "对标账号", language: "zh",
    videos: withText.slice(0, 30).map((v) => ({ title: v.title, duration_sec: v.durationSec ?? 180, views: v.views ?? 1000 })),
  } as Parameters<typeof buildSeriesDetectPrompt>[0]);
  await score("series detection", 8000, "flash", seriesPrompt);

  // 5. comments summary — analyze-channel.ts:1771, budget 1500
  const commentsPrompt = buildCommentsSummaryPrompt({
    videoTitle: mid.title, language: "zh",
    comments: Array.from({ length: 60 }, (_, i) => ({ likes: 500 - i * 7, text: `这个方法我照做了第 ${i + 1} 天，确实有变化，但开头那段有点长` })),
  } as Parameters<typeof buildCommentsSummaryPrompt>[0]);
  await score("comments summary", 1500, "flash", commentsPrompt);

  // 6. channel bible — bible.ts:182, budget 16384
  const biblePrompt = buildChannelBiblePrompt({
    ideaText: "我想做一个面向中国小型创作者的内容教练账号，讲清楚怎么看对标、怎么出选题、怎么写稿。",
    channelDescription: "AI 内容教练", language: "zh",
  } as Parameters<typeof buildChannelBiblePrompt>[0]);
  await score("channel bible", 16384, "flash", biblePrompt);

  // 7. grounding — grounding.ts:66, budget 16384. Redaction over a draft + source.
  const draft = mid.transcript!.slice(0, 4000);
  const groundingPrompt = `You are a fact-grounding editor.\n\nHard rules:\n- Preserve the DRAFT's language, structure, voice, and every grounded sentence unchanged.\n- Do NOT add new facts. Do NOT explain your edits.\n- Output ONLY the corrected document.\n\n## SOURCE MATERIAL\n${big.transcript!.slice(0, 8000)}\n\n## DRAFT\n${draft}`;
  await score("grounding redaction", 16384, "flash", groundingPrompt);

  console.log("\n================ SUMMARY ================");
  for (const r of results) {
    const bar = r.ok === r.runs ? "PASS " : r.ok === 0 ? "DEAD " : "FLAKY";
    console.log(`  ${bar} ${r.path.padEnd(26)} ${r.ok}/${r.runs}  (budget ${r.budget})`);
  }
  const broken = results.filter((r) => r.ok < r.runs);
  console.log(broken.length ? `\nNEEDS FIXING: ${broken.map((r) => r.path).join(", ")}` : "\nall paths healthy on flash");
} finally {
  await client.end();
}
