// Stages a pipeline_runs row for clerk-analyze-single-video and prints the runId for
// `mcp__trigger__trigger_task`, mirroring what stageAndTriggerRun does on the web side.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { clerkVideos } from "../src/schema/clerk";
import { users } from "../src/schema/users";
import { pipelineRuns } from "../src/schema/runs";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env.local") });

const videoId = process.argv[2];
const email = process.argv[3];
if (!videoId || !email) {
  console.error("Usage: tsx smoke-single-video.ts <videoId> <userEmail>");
  process.exit(1);
}

const client = postgres(process.env.DATABASE_URL!, { prepare: false });
const db = drizzle(client);

try {
  const [video] = await db
    .select({
      id: clerkVideos.id,
      title: clerkVideos.title,
      contentType: clerkVideos.contentType,
      channelId: clerkVideos.channelId,
      competitorAccountId: clerkVideos.competitorAccountId,
      coverVisionAt: clerkVideos.coverVisionAt,
    })
    .from(clerkVideos)
    .where(eq(clerkVideos.id, videoId))
    .limit(1);
  if (!video) throw new Error(`video ${videoId} not found`);

  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (!user) throw new Error(`user ${email} not found`);

  const [run] = await db
    .insert(pipelineRuns)
    .values({
      channelId: video.channelId,
      competitorAccountId: video.competitorAccountId,
      agent: "clerk",
      command: "clerk-analyze-single-video",
      status: "pending",
      configJson: { smoke: true, videoId: video.id, language: "zh" },
      userId: user.id,
      quotaCharged: 2,
      total: 3,
    })
    .returning({ id: pipelineRuns.id });

  console.log(
    JSON.stringify({
      runId: run!.id,
      videoId: video.id,
      title: video.title,
      contentType: video.contentType,
      coverAnalyzed: video.coverVisionAt != null,
      payload: { runId: run!.id, userId: user.id, videoId: video.id, language: "zh" },
    }),
  );
} finally {
  await client.end();
}
