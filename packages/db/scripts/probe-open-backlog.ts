// Read-only: how much of the pre-existing backlog is still open in production data.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env.local") });
const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

console.log("=== active bibles: anchored vs legacy whole-book ===");
console.log(
  await sql`select count(*)::int as active,
                   sum((content not like '%POSITIONING%')::int)::int as anchorless
            from poet_bible where is_active = true`,
);

console.log("\n=== quota still exhausted? ===");
console.log(
  await sql`select u.email, uc.minutes_used, uc.bonus_minutes,
                   (300 + uc.bonus_minutes - uc.minutes_used) as remaining
            from usage_counters uc join users u on u.id = uc.user_id
            where uc.period = '2026-07' and (300 + uc.bonus_minutes - uc.minutes_used) < 60
            order by remaining`,
);

await sql.end();
