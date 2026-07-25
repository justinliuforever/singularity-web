// Smoke test for muse-monitor-competitors in links mode: stages a pipeline_runs row for a
// set of pasted video URLs and prints the payload for `mcp__trigger__trigger_task`.
// Mirrors what muse.startMonitor does on the web side, including the quota estimate.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { detectVideoLinkPlatform } from "@goooose/integrations/validators";

import { channels } from "../src/schema/channels";
import { pipelineRuns } from "../src/schema/runs";
import { users } from "../src/schema/users";
import { projects } from "../src/schema/project";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env.local") });

const email = process.argv[2];
const projectSlug = process.argv[3];
const urls = process.argv.slice(4).filter(Boolean);
if (!email || !projectSlug || urls.length === 0) {
  console.error("Usage: tsx smoke-muse-links.ts <userEmail> <projectSlug> <url> [url...]");
  process.exit(1);
}

const MINUTES_PER_REQUESTED_ITEM: Record<string, number> = { xhs: 4, douyin: 3, youtube: 8 };
const estimateRunMinutes = (platform: string, n: number) =>
  n <= 0 ? 0 : Math.round((MINUTES_PER_REQUESTED_ITEM[platform] ?? 4) * n);

const client = postgres(process.env.DATABASE_URL!, { prepare: false });
const db = drizzle(client);

try {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (!user) throw new Error(`user ${email} not found`);

  const [proj] = await db
    .select({ id: projects.id, name: projects.name, platform: projects.platform, ownAccountId: projects.ownAccountId })
    .from(projects)
    .where(and(eq(projects.slug, projectSlug), eq(projects.userId, user.id)))
    .limit(1);
  if (!proj) throw new Error(`project ${projectSlug} not found for ${email}`);

  // projects.own_account_id is the channels row id (own_accounts and channels are twins).
  const [channel] = await db
    .select({ id: channels.id, platform: channels.platform, name: channels.name })
    .from(channels)
    .where(eq(channels.id, proj.ownAccountId))
    .limit(1);
  if (!channel) throw new Error(`no channel row for project ${projectSlug}`);

  const deduped = [...new Set(urls.map((u) => u.trim()))];
  const estimate = deduped.reduce(
    (s, u) => s + estimateRunMinutes(detectVideoLinkPlatform(u) ?? channel.platform, 1),
    0,
  );
  const byPlatform = deduped.map((u) => detectVideoLinkPlatform(u) ?? `${channel.platform}(fallback)`);

  const [run] = await db
    .insert(pipelineRuns)
    .values({
      channelId: channel.id,
      projectId: proj.id,
      agent: "muse",
      command: "muse-monitor-competitors",
      status: "pending",
      configJson: { smoke: true, sourceMode: "links", videoUrls: deduped, numIdeasPerVideo: 3, language: "zh" },
      userId: user.id,
      total: deduped.length,
    })
    .returning({ id: pipelineRuns.id });

  console.log(
    JSON.stringify(
      {
        runId: run!.id,
        project: proj.name,
        channel: channel.name,
        channelPlatform: channel.platform,
        urls: deduped.length,
        detectedPlatforms: byPlatform,
        estimateMinutes: estimate,
        payload: {
          channelId: channel.id,
          projectId: proj.id,
          runId: run!.id,
          userId: user.id,
          numIdeasPerVideo: 3,
          language: "zh",
          sourceMode: "links",
          videoUrls: deduped,
        },
      },
      null,
      2,
    ),
  );
} finally {
  await client.end();
}
