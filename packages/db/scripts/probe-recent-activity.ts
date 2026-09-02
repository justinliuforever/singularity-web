// What has actually happened while nobody was watching: runs, charges, and who did them.
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

await s("runs in the last 30 days, per user per command", () =>
  sql`select u.email, p.command, count(*)::int as runs,
             sum(p.quota_charged)::int as minutes,
             max(p.quota_charged)::int as worst_single,
             round(avg(extract(epoch from (p.completed_at - p.started_at))))::int as avg_sec
      from pipeline_runs p join users u on u.id = p.user_id
      where p.started_at > now() - interval '30 days'
      group by 1,2 order by minutes desc nulls last`);

await s("today's runs in detail", () =>
  sql`select u.email, p.command, p.status, p.quota_charged, p.started_at,
             extract(epoch from (p.completed_at - p.started_at))::int as dur_sec,
             p.config_json
      from pipeline_runs p join users u on u.id = p.user_id
      where p.started_at > now() - interval '36 hours' order by p.started_at desc`);

await s("quota remaining now (base 300 + bonus)", () =>
  sql`select u.email, uc.period, uc.minutes_used, uc.bonus_minutes,
             (300 + uc.bonus_minutes - uc.minutes_used) as remaining
      from usage_counters uc join users u on u.id = uc.user_id
      where uc.period = to_char(now() at time zone 'Asia/Shanghai', 'YYYY-MM')
      order by remaining`);

await s("new users / access requests since Aug 3", () =>
  sql`select email, role, access_status, created_at from users
      where created_at > '2026-08-03' order by created_at desc`);

await sql.end();
