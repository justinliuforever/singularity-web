// Pro's hit rate on the same video-analysis prompt flash now fails ~93% of the time.
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

const parse = (t: string) => {
  let s = t.trim();
  const f = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (f) s = f[1]!.trim();
  try { return JSON.parse(s); } catch {}
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch {} }
  return null;
};

try {
  const vids = await db.select({ transcript: clerkVideos.transcript, title: clerkVideos.title })
    .from(clerkVideos).where(isNotNull(clerkVideos.transcript));
  const pick = vids.filter((v) => (v.transcript?.length ?? 0) > 500)
    .sort((a, b) => b.transcript!.length - a.transcript!.length)[0]!;

  // Two shapes: a typical production transcript and the largest one in the DB.
  for (const [name, chars] of [["typical_1200ch", 1200], ["largest_12000ch", 12000]] as const) {
    const prompt = buildVideoAnalysisPrompt({
      title: pick.title, views: 1_000_000, durationSec: 180, thumbnailUrl: null,
      transcript: pick.transcript!.slice(0, chars), contentType: "xhs_video", language: "zh",
    });
    console.log(`\n=== ${name}  prompt=${prompt.length}ch ===`);
    let ok = 0;
    for (let i = 1; i <= 3; i++) {
      const t0 = Date.now();
      const r = await generateText({ model: llm("pro"), prompt, maxOutputTokens: 16384, temperature: 0.3, maxRetries: 0 });
      const u = r.usage as unknown as Record<string, number | undefined>;
      const p = parse(r.text ?? "");
      if (p) ok++;
      console.log(`  [${i}] ${String(Math.round((Date.now()-t0)/1000)).padStart(3)}s  out=${u?.outputTokens}  reasoning=${u?.reasoningTokens}  text=${(r.text??"").length}ch  parse=${p ? "OK" : "FAIL"}  finish=${r.finishReason}`);
    }
    console.log(`  pro hit rate: ${ok}/3`);
  }
} finally { await client.end(); }
