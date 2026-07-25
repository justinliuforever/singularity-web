// Smoke test for clerk-analyze-channel: creates a pipeline_runs row and prints
// the runId for use with `mcp__trigger__trigger_task`. Optionally polls DB until
// the run reaches a terminal state and prints wall-clock duration.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { pipelineRuns } from "../src/schema/runs";
import { users } from "../src/schema/users";
import { channels } from "../src/schema/channels";
import { competitorAccounts } from "../src/schema/competitor";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env.local") });

const channelId = process.argv[2];
if (!channelId) {
  console.error("Usage: tsx smoke-analyze-channel.ts <channelId>");
  process.exit(1);
}

const client = postgres(process.env.DATABASE_URL!, { prepare: false });
const db = drizzle(client);

const email = process.argv[3];

try {
  const [user] = email
    ? await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
    : [undefined];
  // The id may name an own channel or a competitor account; the task takes either owner.
  const [own] = await db.select({ id: channels.id }).from(channels).where(eq(channels.id, channelId)).limit(1);
  const owner = own ? { channelId } : { competitorAccountId: channelId };

  const [run] = await db
    .insert(pipelineRuns)
    .values({
      ...owner,
      agent: "clerk",
      command: "clerk-analyze-channel",
      status: "pending",
      configJson: {
        smoke: true,
        limit: 5,
        source: "popular",
        mode: "overwrite",
        language: "zh",
      },
      ...(user ? { userId: user.id } : {}),
    })
    .returning({ id: pipelineRuns.id });
  console.log(JSON.stringify({ runId: run!.id, owner, userId: user?.id ?? null }));
} finally {
  await client.end();
}
