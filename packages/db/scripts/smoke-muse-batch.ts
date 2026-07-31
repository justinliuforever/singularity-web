// Post-deploy smoke for muse batch mode: stages a pipeline_runs row for a project's bound
// competitors and prints the payload for `mcp__trigger__trigger_task`.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { channels } from "../src/schema/channels";
import { competitorAccounts } from "../src/schema/competitor";
import { projectCompetitors } from "../src/schema/project";
import { projects } from "../src/schema/project";
import { pipelineRuns } from "../src/schema/runs";
import { users } from "../src/schema/users";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env.local") });

const email = process.argv[2];
const projectSlug = process.argv[3];
const perCompetitor = Number(process.argv[4] ?? 6);
if (!email || !projectSlug) {
  console.error("Usage: tsx smoke-muse-batch.ts <userEmail> <projectSlug> [maxVideosPerCompetitor]");
  process.exit(1);
}

const MINUTES_PER_REQUESTED_ITEM: Record<string, number> = { xhs: 4, douyin: 3, youtube: 8 };

const client = postgres(process.env.DATABASE_URL!, { prepare: false });
const db = drizzle(client);

try {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (!user) throw new Error(`user ${email} not found`);

  const [proj] = await db
    .select({ id: projects.id, name: projects.name, ownAccountId: projects.ownAccountId })
    .from(projects)
    .where(and(eq(projects.slug, projectSlug), eq(projects.userId, user.id)))
    .limit(1);
  if (!proj) throw new Error(`project ${projectSlug} not found for ${email}`);

  const [channel] = await db
    .select({ id: channels.id, name: channels.name })
    .from(channels)
    .where(eq(channels.id, proj.ownAccountId))
    .limit(1);
  if (!channel) throw new Error(`no channel row for project ${projectSlug}`);

  const bound = await db
    .select({ platform: competitorAccounts.platform, url: competitorAccounts.url })
    .from(projectCompetitors)
    .innerJoin(competitorAccounts, eq(competitorAccounts.id, projectCompetitors.competitorAccountId))
    .where(eq(projectCompetitors.projectId, proj.id));
  if (bound.length === 0) throw new Error("project has no bound competitors");

  const estimate = bound.reduce(
    (s, c) => s + Math.round((MINUTES_PER_REQUESTED_ITEM[c.platform] ?? 4) * perCompetitor),
    0,
  );

  const [run] = await db
    .insert(pipelineRuns)
    .values({
      channelId: channel.id,
      projectId: proj.id,
      agent: "muse",
      command: "muse-monitor-competitors",
      status: "pending",
      userId: user.id,
      quotaCharged: 0,
      configJson: {
        language: "zh",
        contentFilter: "all",
        numIdeasPerVideo: 5,
        maxVideosPerCompetitor: perCompetitor,
        smoke: true,
      },
    })
    .returning();
  if (!run) throw new Error("failed to stage run");

  console.log(`project:     ${proj.name} (${projectSlug})`);
  console.log(`competitors: ${bound.map((c) => `${c.platform}:${c.url.slice(0, 40)}`).join("\n             ")}`);
  console.log(`estimate:    ${estimate} minutes`);
  console.log(`run id:      ${run.id}`);
  console.log("\ntrigger_task payload:");
  console.log(
    JSON.stringify(
      {
        channelId: channel.id,
        projectId: proj.id,
        runId: run.id,
        userId: user.id,
        maxVideosPerCompetitor: perCompetitor,
        numIdeasPerVideo: 5,
        language: "zh",
        contentFilter: "all",
      },
      null,
      2,
    ),
  );
} finally {
  await client.end();
}
