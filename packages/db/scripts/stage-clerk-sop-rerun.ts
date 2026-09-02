// Stages an incremental clerk run against a competitor the caller owns: already-analyzed
// videos are skipped, so the run only regenerates the three SOPs. Prints the payload for
// `mcp__trigger__trigger_task`. Mirrors clerk.startAnalysis on the web side.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { competitorAccounts } from "../src/schema/competitor";
import { pipelineRuns } from "../src/schema/runs";
import { users } from "../src/schema/users";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env.local") });

const email = process.argv[2];
const competitorId = process.argv[3];
if (!email || !competitorId) {
  console.error("Usage: tsx stage-clerk-sop-rerun.ts <userEmail> <competitorAccountId>");
  process.exit(1);
}

const client = postgres(process.env.DATABASE_URL!, { prepare: false });
const db = drizzle(client);
try {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (!user) throw new Error(`user ${email} not found`);
  const [comp] = await db
    .select({ id: competitorAccounts.id, name: competitorAccounts.name })
    .from(competitorAccounts)
    .where(and(eq(competitorAccounts.id, competitorId), eq(competitorAccounts.userId, user.id)))
    .limit(1);
  if (!comp) throw new Error(`competitor ${competitorId} not found for ${email}`);

  const [run] = await db
    .insert(pipelineRuns)
    .values({
      competitorAccountId: comp.id,
      agent: "clerk",
      command: "clerk-analyze-channel",
      status: "pending",
      userId: user.id,
      quotaCharged: 0,
      configJson: { limit: 20, source: "popular", mode: "incremental", language: "zh", smoke: true },
    })
    .returning();
  if (!run) throw new Error("failed to stage run");
  console.log(`competitor: ${comp.name}\nrun id:     ${run.id}\n\ntrigger_task payload:`);
  console.log(JSON.stringify({
    competitorAccountId: comp.id, runId: run.id, userId: user.id, limit: 20,
    language: "zh", mode: "incremental", source: "popular", videoIds: [], recencyMonths: null,
  }, null, 2));
} finally {
  await client.end();
}
