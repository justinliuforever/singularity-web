// Read-only: full error text + quota state for today's clerk-analyze-channel failures.
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

await section("FULL TikHub error text (distinct)", () =>
  sql`select distinct error_message from pipeline_runs
      where error_message like 'TikHub%' and started_at > now()-interval '3 days'`);

await section("quota usage now", () =>
  sql`select u.email, uc.period_start, uc.minutes_used
      from usage_counters uc join users u on u.id=uc.user_id
      order by uc.period_start desc, uc.minutes_used desc limit 20`);

await section("quota charged today by user", () =>
  sql`select u.email, sum(p.quota_charged)::int as charged_today, count(*)::int as runs
      from pipeline_runs p join users u on u.id=p.user_id
      where p.started_at > now()-interval '24 hours'
      group by 1 order by charged_today desc`);

await section("the competitor accounts that failed", () =>
  sql`select distinct c.id, c.handle, c.platform, c.profile_url, c.display_name
      from competitor_accounts c
      where c.id in (
        select competitor_account_id from pipeline_runs
        where status='failed' and started_at > now()-interval '2 days'
      )`);

await section("douyin competitors overall", () =>
  sql`select id, handle, platform, left(profile_url,90) as url, display_name, platform_key is not null as has_key
      from competitor_accounts where platform='douyin' order by handle limit 30`);

await section("longest muse runs (7d) with config", () =>
  sql`select id, status, extract(epoch from (completed_at-started_at))::int as dur_sec,
             quota_charged, started_at, config_json
      from pipeline_runs where command='muse-monitor-competitors' and started_at > now()-interval '7 days'
      order by dur_sec desc nulls last limit 6`);

await section("proxy pool summary", () =>
  sql`select enabled, count(*)::int as n, sum(total_ok)::int as ok, sum(total_err)::int as err,
             max(last_used_at) as last_used
      from proxy_sessions group by 1`);

await sql.end();
