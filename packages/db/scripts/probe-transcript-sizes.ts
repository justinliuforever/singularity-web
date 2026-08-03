// Distribution of transcript sizes, to scope how much production content is large enough to
// push the video-analysis prompt past what the 0731 flash build can answer.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env.local") });
const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

console.log("=== clerk transcript size buckets (all time) ===");
console.log(
  await sql`select case
                     when length(transcript) < 1000 then 'a <1k'
                     when length(transcript) < 2000 then 'b 1-2k'
                     when length(transcript) < 4000 then 'c 2-4k'
                     when length(transcript) < 8000 then 'd 4-8k'
                     else 'e >8k' end as bucket,
                   count(*)::int as n
            from clerk_videos where transcript is not null group by 1 order by 1`,
);

console.log("\n=== muse monitor transcript sizes ===");
console.log(
  await sql`select case
                     when length(transcript) < 1000 then 'a <1k'
                     when length(transcript) < 2000 then 'b 1-2k'
                     when length(transcript) < 4000 then 'c 2-4k'
                     else 'd >4k' end as bucket,
                   count(*)::int as n
            from muse_monitor_videos where transcript is not null group by 1 order by 1`,
);

await sql.end();
