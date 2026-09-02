// After a clerk run: which SOPs the competitor now has and how the run settled.
// The activity log lives in Trigger run metadata (`log`), not in pipeline_runs.
import { resolve } from "node:path";
import dotenv from "dotenv";
import postgres from "postgres";
dotenv.config({ path: resolve(import.meta.dirname, "../../../.env.local") });
const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
const [compId, runId] = process.argv.slice(2);
console.table(await sql`select sop_type, language, length(content_md) as chars, run_id::text = ${runId ?? ""} as from_this_run,
  to_char(generated_at, 'MM-DD HH24:MI') as at, left(regexp_replace(content_md, '\s+', ' ', 'g'), 60) as head
  from clerk_sops where competitor_account_id = ${compId} order by sop_type`);
if (runId) {
  const [run] = await sql`select status, error_message, quota_charged, quota_refunded, progress, total, started_at, completed_at
    from pipeline_runs where id = ${runId}`;
  const dur = run?.started_at && run?.completed_at ? `${Math.round((+new Date(run.completed_at) - +new Date(run.started_at)) / 1000)}s` : "?";
  console.log(`run: ${run?.status} ${run?.error_message ?? ""} quota=${run?.quota_charged} refunded=${run?.quota_refunded} progress=${run?.progress}/${run?.total} dur=${dur}`);
}
await sql.end();
