// Read-only: is the users table taking write traffic wildly out of proportion to its size?
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

await section("write amplification: tuples written vs rows held", () =>
  sql`select relname, n_live_tup, n_tup_ins, n_tup_upd, n_tup_hot_upd, n_dead_tup,
             seq_scan, idx_scan, last_autovacuum, last_autoanalyze
      from pg_stat_user_tables
      where n_tup_upd > 0
      order by n_tup_upd desc limit 12`);

await section("stats collection window", () =>
  sql`select stats_reset from pg_stat_database where datname = current_database()`);

await section("users table io / bloat", () =>
  sql`select relname, pg_size_pretty(pg_total_relation_size(relid)) as total,
             pg_size_pretty(pg_relation_size(relid)) as heap, n_live_tup, n_dead_tup
      from pg_stat_user_tables where relname in ('users','usage_counters','pipeline_runs')`);

await sql.end();
