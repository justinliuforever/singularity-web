// Did the analysis actually land, or did we just log a tick over empty fields?
import { resolve } from "node:path";
import dotenv from "dotenv";
import postgres from "postgres";

dotenv.config({ path: resolve(import.meta.dirname, "../../../.env.local") });
const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

console.log(
  JSON.stringify(
    await sql`select left(title, 24) as title,
                     length(coalesce(framework, '')) as framework,
                     length(coalesce(script_structure, '')) as structure,
                     length(coalesce(opening_hook, '')) as hook,
                     length(coalesce(retention_pattern, '')) as retention,
                     length(coalesce(key_takeaways, '')) as takeaways,
                     opening_hook_type
              from clerk_videos
              where analyzed_at > now() - interval '30 minutes'
              order by analyzed_at desc limit 5`,
    null,
    1,
  ),
);

await sql.end();
