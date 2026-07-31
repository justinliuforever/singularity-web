// Read-only production health probe. Every block is isolated so one bad column
// does not abort the rest of the report.
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

await section("pg connection census", () =>
  sql`select coalesce(nullif(application_name,''),'(none)') as app, state, count(*)::int as conns,
             max(extract(epoch from (now()-state_change)))::int as oldest_state_sec
      from pg_stat_activity where datname = current_database()
      group by 1,2 order by conns desc`);

await section("longest running queries (>2s)", () =>
  sql`select pid, state, extract(epoch from (now()-query_start))::int as sec,
             left(regexp_replace(query,'\\s+',' ','g'),120) as q
      from pg_stat_activity
      where datname=current_database() and state<>'idle' and query_start < now()-interval '2 seconds'
      order by sec desc limit 15`);

await section("error_events per day (14d)", () =>
  sql`select date_trunc('day', occurred_at)::date as day, count(*)::int as n
      from error_events where occurred_at > now()-interval '14 days' group by 1 order by 1 desc`);

await section("error_events newest 30", () =>
  sql`select occurred_at, kind, route, method, left(message,180) as message, user_id
      from error_events order by occurred_at desc limit 30`);

await section("pipeline_runs by status (7d)", () =>
  sql`select status, command, count(*)::int as n,
             round(avg(extract(epoch from (completed_at-started_at))))::int as avg_sec,
             max(extract(epoch from (completed_at-started_at)))::int as max_sec
      from pipeline_runs where started_at > now()-interval '7 days'
      group by 1,2 order by n desc`);

await section("pipeline_runs today, newest first", () =>
  sql`select id, command, agent, status, user_id, started_at,
             extract(epoch from (completed_at-started_at))::int as dur_sec,
             quota_charged, quota_refunded, left(coalesce(error_message,''),140) as err
      from pipeline_runs where started_at > now()-interval '36 hours'
      order by started_at desc limit 60`);

await section("stuck / active runs", () =>
  sql`select id, command, status, user_id, started_at,
             extract(epoch from (now()-started_at))::int as age_sec, quota_charged
      from pipeline_runs where status in ('pending','running')
      order by started_at desc limit 30`);

await section("distinct active users per day (14d)", () =>
  sql`select date_trunc('day', started_at)::date as day,
             count(distinct user_id)::int as users, count(*)::int as runs,
             sum((status='failed')::int)::int as failed
      from pipeline_runs where started_at > now()-interval '14 days'
      group by 1 order by 1 desc`);

await section("failed runs by user (7d)", () =>
  sql`select p.user_id, u.email, count(*)::int as failed, sum(p.quota_charged)::int as charged,
             sum(p.quota_refunded::int)::int as refunded
      from pipeline_runs p left join users u on u.id = p.user_id
      where p.started_at > now()-interval '7 days' and p.status='failed'
      group by 1,2 order by failed desc limit 20`);

await section("proxy session pool state", () =>
  sql`select * from proxy_sessions order by 1 limit 40`);

await section("table sizes", () =>
  sql`select relname, n_live_tup, pg_size_pretty(pg_total_relation_size(relid)) as size
      from pg_stat_user_tables order by pg_total_relation_size(relid) desc limit 12`);

await section("seq scan pressure", () =>
  sql`select relname, seq_scan, seq_tup_read, idx_scan, n_live_tup
      from pg_stat_user_tables where n_live_tup > 300 order by seq_tup_read desc limit 12`);

await section("quota usage snapshot", () =>
  sql`select u.email, uc.period_start, uc.minutes_used
      from usage_counters uc join users u on u.id = uc.user_id
      order by uc.period_start desc, uc.minutes_used desc limit 20`);

await sql.end();
