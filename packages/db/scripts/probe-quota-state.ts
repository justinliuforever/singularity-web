// Read-only: are any users out of quota right now, and how much does one run cost them?
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env.local") });

const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

async function section(title: string, fn: () => Promise<unknown>) {
  console.log(`\n===== ${title} =====`);
  try {
    console.log(JSON.stringify(await fn(), null, 1));
  } catch (err) {
    console.log(`  [FAILED] ${(err as Error).message}`);
  }
}

await section("quota per user (current + prior periods)", () =>
  sql`select u.email, u.role, u.access_status, uc.period, uc.minutes_used, uc.bonus_minutes,
             uc.contents_used, uc.generations_used, uc.updated_at
      from usage_counters uc join users u on u.id=uc.user_id
      order by uc.period desc, uc.minutes_used desc`);

await section("all users + access", () =>
  sql`select email, role, access_status, created_at from users order by created_at desc limit 30`);

await section("quota charged per run, this month, per user", () =>
  sql`select u.email, p.command, count(*)::int as runs, sum(p.quota_charged)::int as minutes,
             max(p.quota_charged)::int as worst_single
      from pipeline_runs p join users u on u.id=p.user_id
      where p.started_at >= date_trunc('month', now())
      group by 1,2 order by minutes desc`);

await section("worst single charges ever", () =>
  sql`select u.email, p.command, p.quota_charged, p.status,
             extract(epoch from (p.completed_at-p.started_at))::int as dur_sec, p.started_at
      from pipeline_runs p join users u on u.id=p.user_id
      order by p.quota_charged desc limit 15`);

await section("competitor_accounts columns", () =>
  sql`select column_name, data_type from information_schema.columns
      where table_name='competitor_accounts' order by ordinal_position`);

await sql.end();
