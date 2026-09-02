// Reproduces PR #12's claim on the real human-SOP prompt: does Pro return empty at 16384, and
// does Flash (thinking off) complete it? Rebuilds videosData exactly as analyze-channel does
// for a channel under the 80k reduce budget (raw pass-through, no partial reduce), so the
// prompt is byte-for-byte what production sends. Read-only; writes nothing.
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
import dotenv from "dotenv";
import { generateText } from "ai";
import postgres from "postgres";

import { buildHumanSopPrompt } from "@goooose/prompts/clerk";
import { llm } from "@goooose/integrations/clients/llm";

dotenv.config({ path: resolve(import.meta.dirname, "../../../.env.local") });
const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
const RUNS = Number(process.env.RUNS ?? 3);
const NOTE = `GROUNDING — write the SOP only from the per-video pattern summaries below. Each summary already distills one video's grounded techniques; never quote lines, cite [m:ss], invent a beat-by-beat structure, or assert per-video frequency counts beyond what the summaries state. Put a phrase in quotation marks with a [Video N] / [Post N] citation (match the block's own label) ONLY if it appears verbatim in a summary; paraphrase or inference takes no quotes and no citation. When writing in Chinese, refer to blocks labeled "Post N (image note)" as 帖子N（图文） and "Post N (video note)" as 帖子N（视频）, never as 视频N. If a video has no pattern summary, infer only from its title and label it inference. If most videos lack spoken detail, say so plainly and keep the SOP at the title/cover-pattern level instead of fabricating depth.

COVER RULES — a block's "Cover (vision)" lines are a first-hand read of that post's actual cover image. These rules apply in EVERY section and appendix, and override anything that conflicts with them:
1. A post whose block carries no "Cover (vision)" line had no cover analysis. Say so plainly. Never state what its cover shows, and never fill the gap from its title, its transcript, or another post's cover. The "infer from the title" allowance above covers the pattern summary ONLY — a missing pattern summary does not turn a present Cover line into an inference.
2. Cover text may be quoted only from a "Cover (vision)" line, copied character-for-character. A post's title is NOT its cover text; they are different strings and often unrelated. Never present a title as cover copy.
3. Invent no figures — no colour codes, no percentage of frame, no line-count caps, no cadences — unless that exact figure appears in a Cover line. If reads disagree on a figure, say it varies; never average them into a range.
4. Open the cover section by stating the evidence base: which posts have a cover read and which do not, before any channel-wide rule.
5. Never state a cover pattern as a fraction or with 所有/全部/多数/一律/必须. Name the posts you observed it in, and in the same breath name any post whose read lacks it or differs, and how. One element per claim — never bundle two elements to make a pattern look stronger.
6. Every cover claim, anywhere in the SOP, must name its posts in full 帖子N（视频）/帖子N（图文） form — including inside lists and tables. Before naming a post, confirm the element is in that post's own read, worded as that read words it: if the read says yellow TEXT, do not write yellow BACKGROUND. Drop posts that do not check out; drop the claim if none survives.
7. If a Cover line hedges an element (看不清 / 疑似 / 无法确认), it is not established. Never assert it as a pattern, prop, or rule.
8. Do not attach a descriptor to posts whose reads lack it. If one read says 圆框 and another 细框, the shared claim is 眼镜 — describe the common denominator or split the claim per post.
9. Cover facts describe the cover only. Never carry them into the video body, and never present cover copy as a spoken line, a script opening, or an in-video beat.\n\n`;

const ID = "00b3b137-49bb-4c7b-bd43-2cede4254ca8";
const vids = await sql`select title, views, duration_sec, transcript_source, sop_map_summary
  from clerk_videos where competitor_account_id = ${ID} and sop_map_summary is not null
  order by views desc nulls last`;
const blocks = vids.map((v, i) => [
  `### Video ${i + 1}: "${v.title || "(untitled)"}"`,
  `- Views: ${v.views != null ? Number(v.views).toLocaleString("en-US") : "unknown"}`,
  `- Duration: ${v.duration_sec ?? "unknown"}s`,
  `- Transcript source: ${v.transcript_source ?? "none"}`,
  `\n${v.sop_map_summary}`,
].join("\n"));
const videosData = NOTE + blocks.join("\n\n");
const prompt = buildHumanSopPrompt({
  channelName: "超级龙说", videoCount: vids.length,
  totalViews: vids.reduce((s, v) => s + Number(v.views ?? 0), 0),
  date: new Date().toISOString().slice(0, 10), videosData, transcriptCount: vids.length, language: "zh",
});
console.log(`videos ${vids.length} | videosData ${videosData.length}ch | prompt ${prompt.length}ch\n`);

const SECTIONS = [/Section 1|第一|## 1/i, /Section 2|## 2/i, /Section 3|## 3/i, /Section 4|## 4/i, /Section 5|## 5/i, /Section 6|## 6/i, /Section 7|## 7/i, /Appendix A|附录 ?A/i, /Appendix B|附录 ?B/i];
const rows: string[] = [];
for (const tier of ["pro", "flash"] as const) {
  for (let i = 1; i <= RUNS; i++) {
    const t0 = Date.now();
    try {
      const r = await generateText({ model: llm(tier), prompt, maxOutputTokens: 16384, temperature: 0.4, maxRetries: 2 });
      const u = r.usage as unknown as Record<string, number | undefined>;
      const text = (r.text ?? "").trim();
      const secs = SECTIONS.filter((re) => re.test(text)).length;
      const line = `${tier.padEnd(5)} [${i}] ${String(Math.round((Date.now() - t0) / 1000)).padStart(3)}s  out=${String(u?.outputTokens).padStart(5)} reasoning=${String(u?.reasoningTokens ?? 0).padStart(5)}  text=${String(text.length).padStart(5)}ch  sections=${secs}/9  finish=${r.finishReason}  ${text.length === 0 ? "EMPTY" : r.finishReason === "length" ? "TRUNCATED" : secs >= 8 ? "COMPLETE" : "partial"}`;
      console.log(line); rows.push(line);
      writeFileSync(`/tmp/humansop_${tier}_${i}.md`, text);
    } catch (err) {
      const line = `${tier.padEnd(5)} [${i}] ERR ${(err as Error).message.slice(0, 80)}`;
      console.log(line); rows.push(line);
    }
  }
}
writeFileSync("/tmp/humansop_ab.txt", rows.join("\n"));
await sql.end();
