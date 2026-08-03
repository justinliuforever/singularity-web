// Finds the prompt size at which the 0731 flash build stops emitting any text — it spends the
// whole output budget on reasoning and returns "". Sweeps transcript length through the real
// video-analysis prompt. Run: pnpm --filter @goooose/db exec tsx scripts/probe-flash-threshold.ts
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

const BUDGET = 16384;

async function probe(transcriptChars: number, transcript: string, title: string) {
  const prompt = buildVideoAnalysisPrompt({
    title,
    views: 1_000_000,
    durationSec: 180,
    thumbnailUrl: null,
    transcript: transcript.slice(0, transcriptChars),
    contentType: "xhs_video",
    language: "zh",
  });
  const t0 = Date.now();
  let text = "";
  let finish = "";
  let out = 0;
  let reasoning = 0;
  try {
    const r = await generateText({
      model: llm("flash"),
      prompt,
      maxOutputTokens: BUDGET,
      temperature: 0.3,
      maxRetries: 0,
    });
    text = r.text ?? "";
    finish = r.finishReason ?? "";
    const u = r.usage as unknown as Record<string, number | undefined>;
    out = Number(u?.outputTokens ?? 0);
    reasoning = Number(u?.reasoningTokens ?? 0);
  } catch (err) {
    finish = "ERR:" + (err as Error).message.slice(0, 40);
  }
  const sec = Math.round((Date.now() - t0) / 1000);
  const verdict = text.length === 0 ? "DEAD" : text.length < 200 ? "thin" : "ok";
  console.log(
    `  prompt=${String(prompt.length).padStart(6)}ch  ${String(sec).padStart(3)}s  out=${String(out).padStart(4)}  reasoning=${String(reasoning).padStart(4)}  text=${String(text.length).padStart(5)}ch  finish=${finish.padEnd(6)} ${verdict}`,
  );
  return { promptChars: prompt.length, textChars: text.length };
}

try {
  const vids = await db
    .select({ transcript: clerkVideos.transcript, title: clerkVideos.title })
    .from(clerkVideos)
    .where(isNotNull(clerkVideos.transcript));
  const pick = vids
    .filter((v) => (v.transcript?.length ?? 0) > 500)
    .sort((a, b) => b.transcript!.length - a.transcript!.length)[0];
  if (!pick) throw new Error("no usable transcript in DB");

  console.log(`flash @ maxOutputTokens=${BUDGET}, real buildVideoAnalysisPrompt, varying transcript length\n`);
  const results = [];
  for (const n of [500, 2000, 6000, 12000]) {
    if (n > pick.transcript!.length && n !== 200) continue;
    results.push(await probe(n, pick.transcript!, pick.title));
  }

  const lastOk = results.filter((r) => r.textChars > 0).pop();
  const firstDead = results.find((r) => r.textChars === 0);
  console.log(
    `\nlast prompt that produced text: ${lastOk ? lastOk.promptChars + "ch" : "none"}` +
      `\nfirst prompt that produced nothing: ${firstDead ? firstDead.promptChars + "ch" : "none in range"}`,
  );
} finally {
  await client.end();
}
