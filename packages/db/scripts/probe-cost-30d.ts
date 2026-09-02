import { resolve } from "node:path";
import dotenv from "dotenv";
import postgres from "postgres";
dotenv.config({ path: resolve(import.meta.dirname, "../../../.env.local") });
const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
console.log(JSON.stringify(await sql`
  select resource_type, provider,
         count(*)::int as calls,
         round(sum(estimated_cost_usd)::numeric, 4) as usd
  from usage_events where created_at > now() - interval '30 days'
  group by 1,2 order by usd desc nulls last`, null, 1));
console.log("\n=== 30 天总花费 ===");
console.log(JSON.stringify(await sql`
  select round(sum(estimated_cost_usd)::numeric, 2) as total_usd,
         count(*)::int as events
  from usage_events where created_at > now() - interval '30 days'`, null, 1));
await sql.end();
