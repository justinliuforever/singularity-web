/**
 * Frozen-input verification for buildImagePostSopPrompt.
 *
 * Picks real xhs_image / douyin_image rows (one with a cover read, one without),
 * generates N samples each, and greps for markers that can only be fabrications on
 * an image post: timecodes, runtime, and video-only retention metrics. The no-cover
 * row additionally must contain no claim about the cover image.
 *
 * Run: pnpm --filter @goooose/db image-sop-smoke
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env.local") });

const { and, eq, isNotNull, isNull, desc } = await import("drizzle-orm");
const { drizzle } = await import("drizzle-orm/postgres-js");
const postgres = (await import("postgres")).default;
const { clerkVideos } = await import("../src/schema/clerk");
const { buildImagePostSopPrompt } = await import("@goooose/prompts/clerk");
const { llm } = await import("@goooose/integrations/clients/llm");
const { generateText } = await import("ai");

const client = postgres(process.env.DATABASE_URL!, { prepare: false });
const db = drizzle(client);

const SAMPLES = Number(process.env.SAMPLES ?? 3);

const FORBIDDEN: Array<[string, RegExp]> = [
  ["[m:ss] 时间码", /\[\d+:\d{2}\]/],
  ["第N秒", /第\s*\d+\s*秒/],
  ["完播", /完播/],
  ["播放量", /播放量/],
  ["观看时长", /观看时长/],
  ["黄金前3秒", /黄金前\s*\d\s*秒/],
];

// Only the fabrication signatures. Bare 画面 is ordinary Chinese for "mental imagery"
// and fires on legitimate copy analysis; what must never appear is a guessed description
// of THIS cover, or a citation of a visual analysis that was never run.
const COVER_CLAIM =
  /封面[^\n]{0,12}(很可能|可能是|推测|应该是|大概|看起来)|视觉分析[^\n]{0,6}(提到|显示|里|中)|配色|构图|字号|排版|色调|缩略图/;

function summarizeAnalysis(v: typeof clerkVideos.$inferSelect): string {
  return (
    [
      ["Framework", v.framework],
      ["Opening hook", v.openingHook],
      ["Hooks throughout", v.hooksThroughout],
      ["Script structure", v.scriptStructure],
      ["Key takeaways", v.keyTakeaways],
    ] as Array<[string, string | null]>
  )
    .filter(([, val]) => val)
    .map(([k, val]) => `**${k}**: ${val}`)
    .join("\n\n");
}

let pass = 0;
let fail = 0;
function ok(label: string, cond: boolean, detail?: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail && !cond ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
}

async function runCase(label: string, row: typeof clerkVideos.$inferSelect, expectCover: boolean) {
  console.log(`\n## ${label}: 「${row.title.slice(0, 40)}」(${row.contentType}, 正文 ${row.transcript?.length ?? 0} 字)`);
  const prompt = buildImagePostSopPrompt({
    channelName: row.sourceChannelName ?? "测试账号",
    title: row.title,
    engagementScore: row.views ?? null,
    url: row.url,
    caption: row.transcript ?? "",
    coverDescription: row.thumbnailDescription,
    coverWhyItWorks: row.thumbnailWhyItWorks,
    coverDiagnosis: row.coverDiagnosis,
    coverTitleSuggestions: row.coverTitleSuggestions,
    analysisSummary: summarizeAnalysis(row),
    commentsSummary: null,
    language: "zh",
  });

  for (let i = 1; i <= SAMPLES; i++) {
    const { text } = await generateText({
      model: llm("pro"),
      prompt,
      maxOutputTokens: 16384,
      temperature: 0.4,
      maxRetries: 2,
    });
    const hits = FORBIDDEN.filter(([, re]) => re.test(text)).map(([name]) => name);
    ok(`样本 ${i}：无视频专属指标（${text.length} 字）`, hits.length === 0, hits.join(", "));
    if (!expectCover) {
      const coverHit = text.match(COVER_CLAIM);
      ok(`样本 ${i}：未编造封面判断`, !coverHit, coverHit?.[0]);
      if (process.env.SHOW_COVER_LINES && coverHit) {
        for (const line of text.split("\n")) {
          if (COVER_CLAIM.test(line)) console.log(`      » ${line.trim().slice(0, 220)}`);
        }
      }
    }
    ok(`样本 ${i}：含可复用模板`, /可复用模板|骨架表|句式库/.test(text));
  }
}

const withCover = await db
  .select()
  .from(clerkVideos)
  .where(and(eq(clerkVideos.contentType, "xhs_image"), isNotNull(clerkVideos.coverDiagnosis)))
  .orderBy(desc(clerkVideos.views))
  .limit(1);

const withoutCover = await db
  .select()
  .from(clerkVideos)
  .where(and(eq(clerkVideos.contentType, "xhs_image"), isNull(clerkVideos.coverDiagnosis)))
  .limit(1);

console.log(`image-sop-smoke · ${SAMPLES} 次采样/用例`);
if (withCover[0]) await runCase("有封面分析", withCover[0], true);
else console.log("  (跳过：库里没有带封面分析的图文)");
if (withoutCover[0]) await runCase("无封面分析", withoutCover[0], false);
else console.log("  (跳过：库里没有缺封面分析的图文)");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
