import { resolve } from "node:path";
import dotenv from "dotenv";
import postgres from "postgres";
dotenv.config({ path: resolve(import.meta.dirname, "../../../.env.local") });
const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
console.table(await sql`select sop_type, (channel_id is not null) as has_channel, (own_account_id is not null) as has_own,
  (competitor_account_id is not null) as has_comp, (video_id is not null) as has_video, count(*)::int
  from clerk_sops group by 1,2,3,4,5 order by 1,2,3,4,5`);
console.table(await sql`select s.sop_type, c.name as channel_name, o.name as own_name, ca.name as comp_name, v.title as video_title
  from clerk_sops s left join channels c on c.id=s.channel_id left join own_accounts o on o.id=s.own_account_id
  left join competitor_accounts ca on ca.id=s.competitor_account_id left join clerk_videos v on v.id=s.video_id
  where s.competitor_account_id is not null order by s.generated_at desc limit 6`);
await sql.end();
