import { resolve } from "node:path";
import dotenv from "dotenv";
import postgres from "postgres";
dotenv.config({ path: resolve(import.meta.dirname, "../../../.env.local") });
const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
const s = async (t: string, f: () => Promise<unknown>) => {
  console.log(`\n===== ${t} =====`);
  try { console.log(JSON.stringify(await f(), null, 1)); }
  catch (e) { console.log(`  [FAILED] ${(e as Error).message}`); }
};

await s("beta_applications columns", () =>
  sql`select column_name from information_schema.columns
      where table_name='beta_applications' order by ordinal_position`);

await s("beta_applications by status", () =>
  sql`select status, count(*)::int as n, min(created_at) as oldest, max(created_at) as newest
      from beta_applications group by 1 order by n desc`);

await s("applications submitted since Aug 3", () =>
  sql`select email, status, created_at, now()::date - created_at::date as days
      from beta_applications where created_at > '2026-08-03' order by created_at desc limit 20`);

await s("redemption codes: issued vs used", () =>
  sql`select count(*)::int as total,
             sum((redeemed_at is not null)::int)::int as redeemed
      from redemption_codes`);

await sql.end();
