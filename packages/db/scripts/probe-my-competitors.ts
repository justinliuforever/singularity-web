import { resolve } from "node:path";
import dotenv from "dotenv";
import postgres from "postgres";
dotenv.config({ path: resolve(import.meta.dirname, "../../../.env.local") });
const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
const me = await sql`select id, email from users where email = 'justinliuforever@gmail.com'`;
console.log("me:", me[0]?.id);
console.table(await sql`
  select ca.id, ca.name, ca.platform, ca.url,
    (select count(*) from clerk_videos v where v.competitor_account_id = ca.id) as videos,
    (select count(*) from clerk_videos v where v.competitor_account_id = ca.id and v.sop_map_summary is not null) as mapped,
    (select string_agg(s.sop_type || ':' || to_char(s.generated_at, 'MM-DD'), ' ' order by s.sop_type) from clerk_sops s where s.competitor_account_id = ca.id) as sops,
    (select count(*) from pipeline_runs r where r.competitor_account_id = ca.id) as runs
  from competitor_accounts ca where ca.user_id = ${me[0]!.id} order by mapped desc limit 12`);
console.table(await sql`select id, name, platform from own_accounts where user_id = ${me[0]!.id}`);
console.table(await sql`select id, name, user_id from channels where user_id = ${me[0]!.id}`);
await sql.end();
