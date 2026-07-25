import { logger, metadata, task } from "@trigger.dev/sdk";
import { generateText } from "ai";
import { and, eq, ne } from "drizzle-orm";

import {
  channels,
  channelSeries,
  flushProxyPool,
  loadProxyPool,
  pipelineRuns,
  type SeriesVideoRef,
} from "@goooose/db";

import { withMeteredRunDb } from "../lib/metered-run";
import { userRunsQueue } from "../lib/queues";
import { llm } from "@goooose/integrations/clients/llm";
import {
  buildSeriesDetectPrompt,
  type SeriesDetectResponse,
} from "@goooose/prompts/clerk-series";
import { listChannelVideos } from "@goooose/integrations/clients/ytdlp";
import { fetchVideoMetadataBatch } from "@goooose/integrations/clients/youtube-data";
import { parseLlmJson } from "@goooose/integrations/utils";

type Payload = {
  channelId: string;
  runId: string;
  userId?: string;
  // Default 100 — yt-dlp flat-playlist handles it cheaply.
  videoCount?: number;
  language?: "en" | "zh";
};


export const detectChannelSeries = task({
  id: "clerk-detect-channel-series",
  queue: userRunsQueue,
  maxDuration: 600,
  run: async (payload: Payload) => {
    const videoCount = payload.videoCount ?? 100;
    const language = payload.language ?? "zh";

    return withMeteredRunDb({ runId: payload.runId, userId: payload.userId, feature: "clerk-detect-channel-series" }, async (db) => {
      const [channel] = await db
        .select()
        .from(channels)
        .where(eq(channels.id, payload.channelId))
        .limit(1);
      if (!channel) throw new Error(`channel ${payload.channelId} not found`);
      if (channel.platform !== "youtube") {
        throw new Error("series detect only supports YouTube channels currently");
      }

      const [started] = await db
        .update(pipelineRuns)
        .set({ status: "running", total: 3, startedAt: new Date() })
        .where(and(eq(pipelineRuns.id, payload.runId), ne(pipelineRuns.status, "failed")))
        .returning({ id: pipelineRuns.id });
      if (!started) throw new Error("run already settled (reaped) — aborting to avoid double-deliver");

      const proxyPool = await loadProxyPool(db, { provider: "wealthproxies" });
      if (proxyPool.size === 0) throw new Error("proxy pool empty");

      await metadata.set("progress", {
        current: 0,
        total: 3,
        phase: "fetching channel videos",
        detail: `抓取最近 ${videoCount} 个视频元信息`,
      });

      const session = proxyPool.checkout();
      let videos;
      try {
        videos = await listChannelVideos(channel.platformUrl, videoCount, session.url, logger);
        proxyPool.reportOk(session, 5_000);
      } catch (err) {
        proxyPool.reportErr(session, (err as Error).message, "other");
        throw err;
      }

      logger.info(`Pulled ${videos.length} videos for series detection`);
      if (videos.length < 3) {
        throw new Error(`Only ${videos.length} videos found — need ≥ 3 to detect series`);
      }

      await metadata.set("progress", {
        current: 1,
        total: 3,
        phase: "clustering by AI",
        detail: "DeepSeek 按主题归类",
      });

      const prompt = buildSeriesDetectPrompt({
        channelName: channel.name,
        videos: videos.map((v) => ({
          title: v.title,
          duration_sec: v.duration_sec,
          views: v.views,
        })),
        language,
      });

      // Title-only clustering is a Flash-tier task; fall back to Pro only if Flash
      // emits empty output (DeepSeek's reasoning-budget-empty-text quirk).
      let result = await generateText({
        model: llm("flash"),
        prompt,
        maxOutputTokens: 8000,
        temperature: 0.3,
        maxRetries: 2,
      });
      if (result.text.length === 0) {
        logger.warn("Flash returned empty for series detect; retrying with Pro");
        result = await generateText({
          model: llm("pro"),
          prompt,
          maxOutputTokens: 12000,
          temperature: 0.3,
          maxRetries: 2,
        });
      }

      const parsed = (await parseLlmJson(result.text).catch(() => null)) as SeriesDetectResponse | null;
      if (!parsed || !Array.isArray(parsed.series)) {
        throw new Error(
          `Series JSON parse failed. finish=${result.finishReason ?? "unknown"} len=${result.text.length} head=${result.text.slice(0, 300)}`,
        );
      }
      logger.info(`Detected ${parsed.series.length} series`);

      await metadata.set("progress", {
        current: 2,
        total: 3,
        phase: "saving to DB",
        detail: `写入 ${parsed.series.length} 个系列`,
      });

      // Enrich with YT Data API so sampleVideos carry real viewCount + publishedAt
      // (yt-dlp flat returns null/0 for both).
      const enrich = await fetchVideoMetadataBatch(videos.map((v) => v.video_id));
      logger.info(`Enriched ${enrich.size}/${videos.length} videos via YT Data API`);

      // Replace prior detection for this channel (single canonical clustering per run).
      await db.delete(channelSeries).where(eq(channelSeries.channelId, channel.id));

      let insertedSeriesCount = 0;
      for (const s of parsed.series) {
        if (!s.name || !Array.isArray(s.video_indices)) continue;
        const sampleVideos: SeriesVideoRef[] = s.video_indices
          .map((idx) => videos[idx - 1])
          .filter((v): v is NonNullable<typeof v> => !!v)
          .map((v) => {
            const yt = enrich.get(v.video_id);
            return {
              video_id: v.video_id,
              title: yt?.title || v.title,
              duration_sec: yt?.durationSec ?? v.duration_sec,
              views: yt?.viewCount ?? v.views,
              published_at: yt?.publishedAt ?? v.published_at,
            };
          });
        if (sampleVideos.length === 0) continue;
        await db.insert(channelSeries).values({
          channelId: channel.id,
          ownAccountId: channel.id,
          name: s.name.slice(0, 80),
          description: s.description?.slice(0, 500) ?? null,
          videoCount: s.video_indices.length,
          sampleVideos,
        });
        insertedSeriesCount++;
      }

      const flushed = await flushProxyPool(db, proxyPool);
      logger.info(
        `Pool flushed: ${flushed.updatedSessions} touched, ${flushed.newlyDisabled} newly disabled`,
      );

      await db
        .update(pipelineRuns)
        .set({ status: "done", completedAt: new Date(), progress: 3, total: 3 })
        .where(eq(pipelineRuns.id, payload.runId));

      return {
        videosScanned: videos.length,
        seriesDetected: insertedSeriesCount,
      };
    });
  },
});
