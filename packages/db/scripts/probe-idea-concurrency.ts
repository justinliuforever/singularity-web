// Read-only: did the idea rows of one run overlap in time, or run one after another?
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env.local") });

const runId = process.argv[2];
if (!runId) {
  console.error("Usage: tsx probe-idea-concurrency.ts <pipeline_runs.id>");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

console.log("=== per source video: when its ideas landed ===");
console.log(
  await sql`select source_video_id,
                   count(*)::int as ideas,
                   min(idea_number)::int as first_no,
                   max(idea_number)::int as last_no,
                   min(generated_at) as landed
            from muse_ideas where run_id = ${runId}
            group by 1 order by landed`,
);

console.log("\n=== gaps between consecutive source videos (seconds) ===");
console.log(
  await sql`select source_video_id, landed,
                   round(extract(epoch from (landed - lag(landed) over (order by landed))))::int as gap_sec
            from (
              select source_video_id, min(generated_at) as landed
              from muse_ideas where run_id = ${runId} group by 1
            ) t order by landed`,
);

console.log("\n=== run wall clock ===");
console.log(
  await sql`select started_at, completed_at,
                   extract(epoch from (completed_at - started_at))::int as dur_sec,
                   quota_charged, status
            from pipeline_runs where id = ${runId}`,
);

await sql.end();
