// Read-only: find a project with bound competitors, for a post-deploy muse smoke run.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env.local") });

const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

console.log("=== projects with bound competitors ===");
console.log(
  await sql`select p.id as project_id, p.slug, p.name, p.own_account_id, u.email,
                   count(pc.competitor_account_id)::int as competitors
            from projects p
            join users u on u.id = p.user_id
            left join project_competitors pc on pc.project_id = p.id
            group by 1,2,3,4,5
            having count(pc.competitor_account_id) > 0
            order by u.email, competitors desc`,
);

console.log("\n=== already-ideated videos per project (orphan recovery scope) ===");
console.log(
  await sql`select project_id, count(*)::int as ideas from muse_ideas group by 1 order by ideas desc limit 10`,
);

await sql.end();
