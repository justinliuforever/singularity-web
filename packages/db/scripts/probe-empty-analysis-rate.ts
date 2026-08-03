// How often did production actually lose an analysis to the empty-text failure, and when did
// it start? clerk_videos rows analysed but left with no structured fields are the fingerprint.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env.local") });
const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

const section = async (title: string, fn: () => Promise<unknown>) => {
  console.log(`\n===== ${title} =====`);
  try {
    console.log(JSON.stringify(await fn(), null, 1));
  } catch (err) {
    console.log(`  [FAILED] ${(err as Error).message}`);
  }
};

await section("analysed rows with an empty analysis, by day", () =>
  sql`select date_trunc('day', analyzed_at)::date as day,
             count(*)::int as analysed,
             sum((framework is null and script_structure is null and opening_hook is null)::int)::int as empty
      from clerk_videos
      where analyzed_at > now() - interval '21 days'
      group by 1 order by 1 desc`);

await section("transcript length: empty-analysis rows vs healthy ones (14d)", () =>
  sql`select (framework is null and script_structure is null and opening_hook is null) as is_empty,
             count(*)::int as n,
             round(avg(length(coalesce(transcript,''))))::int as avg_transcript,
             max(length(coalesce(transcript,'')))::int as max_transcript
      from clerk_videos
      where analyzed_at > now() - interval '14 days'
      group by 1`);

await section("runs whose error mentions the parse failure", () =>
  sql`select date_trunc('day', started_at)::date as day, count(*)::int as n
      from pipeline_runs
      where error_message ilike '%parse analysis%' and started_at > now() - interval '21 days'
      group by 1 order by 1 desc`);

await sql.end();
