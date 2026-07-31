// Read-only: find a Douyin competitor owned by the admin account, for a post-deploy smoke run.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env.local") });

const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

console.log("=== competitor_accounts columns ===");
console.log(
  await sql`select column_name from information_schema.columns
            where table_name='competitor_accounts' order by ordinal_position`,
);

console.log("\n=== douyin competitors + owner ===");
console.log(
  await sql`select c.id, c.platform, c.user_id, u.email,
                   left(c.url, 70) as url, c.name
            from competitor_accounts c left join users u on u.id = c.user_id
            where c.platform = 'douyin' limit 20`,
);

await sql.end();
