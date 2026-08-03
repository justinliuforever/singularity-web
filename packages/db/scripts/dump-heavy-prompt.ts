// Writes the median-sized real video-analysis prompt to a file, for raw-API experiments.
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
import dotenv from "dotenv";
import { isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { buildVideoAnalysisPrompt } from "@goooose/prompts/clerk";
import { clerkVideos } from "../src/schema";

dotenv.config({ path: resolve(import.meta.dirname, "../../../.env.local") });
const c = postgres(process.env.DATABASE_URL!, { prepare: false });
const db = drizzle(c);
const vids = await db
  .select({ t: clerkVideos.transcript, ti: clerkVideos.title })
  .from(clerkVideos)
  .where(isNotNull(clerkVideos.transcript));
const w = vids.filter((v) => (v.t?.length ?? 0) > 300).sort((a, b) => b.t!.length - a.t!.length);
const mid = w[Math.floor(w.length / 2)]!;
const p = buildVideoAnalysisPrompt({
  title: mid.ti, views: 1000, durationSec: 180, thumbnailUrl: null,
  transcript: mid.t!, contentType: "xhs_video", language: "zh",
});
writeFileSync("/tmp/heavy_prompt.txt", p);
console.log(`prompt ${p.length}ch written (transcript ${mid.t!.length}ch)`);
await c.end();
