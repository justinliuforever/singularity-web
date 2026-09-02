// Anything waiting on a human: access requests and beta applications nobody has actioned.
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

await s("tables that look like a queue", () =>
  sql`select table_name from information_schema.tables
      where table_schema='public' and (table_name like '%applica%' or table_name like '%allow%'
        or table_name like '%redempt%' or table_name like '%request%')
      order by 1`);

await s("users pending access, oldest first", () =>
  sql`select email, created_at, now()::date - created_at::date as days_waiting
      from users where access_status = 'pending' order by created_at`);

await s("access_status distribution", () =>
  sql`select access_status, count(*)::int as n from users group by 1 order by n desc`);

await sql.end();
