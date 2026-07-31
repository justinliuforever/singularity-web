import { logger, metadata, task } from "@trigger.dev/sdk";
import { and, eq, inArray, isNull, ne, notInArray, sql } from "drizzle-orm";

import {
  channels,
  clerkSops,
  competitorAccounts,
  settleRunMinutes,
  videoMinutes,
  IDEATION_MINUTES,
  flushProxyPool,
  loadProxyPool,
  museIdeas,
  museMonitorVideos,
  pipelineRuns,
  projectCompetitors,
  resolveActiveBible,
} from "@goooose/db";

import { withMeteredRunDb } from "../lib/metered-run";
import { userRunsQueue } from "../lib/queues";
import { selectBibleSections } from "@goooose/domain/services/poet/bible";
import {
  likelyChineseText,
  renderTranscriptWithTimestamps,
  transcribeFromStreams,
  transcribeYoutubeVideo,
} from "@goooose/integrations/clients/asr";
import { withProxyRetry, type ProxyPool } from "@goooose/integrations/proxy";
import {
  getVideoMetadataYtdlp,
  listChannelVideos,
} from "@goooose/integrations/clients/ytdlp";
import {
  buildDouyinAsrStreams,
  extractDouyinAwemeId,
  extractDouyinSecUserId,
  getDouyinUserVideos,
  getDouyinVideoDetail,
  resolveDouyinUser,
  type DouyinPlaySource,
  type DouyinVideo,
} from "@goooose/integrations/clients/douyin";
import {
  detectVideoLinkPlatform,
  extractYoutubeVideoId,
} from "@goooose/integrations/validators";
import {
  expandXhsShortLink,
  extractXhsNoteId,
  extractXsecToken,
  getXhsNoteDetail,
  getXhsUserNotes,
  type XhsNote,
} from "@goooose/integrations/clients/xhs";
import { isRealTranscript } from "@goooose/domain/schemas/muse";
import {
  analyzeViralTrigger,
  classifyVideo,
  generateIdeas,
} from "@goooose/domain/services/muse";
import pLimit from "p-limit";

import { asPositiveNumber, parseDurationToSec, safeText, sleep } from "@goooose/integrations/utils";

const ASR_MAX_DURATION_SEC = 60 * 60;
const DEFAULT_NUM_IDEAS = 5;
// Matches the width analyze-channel has run its ASR+LLM loop at in production for weeks.
const IDEA_CONCURRENCY = 8;
// Lower than ideas: each of these holds a downloaded file on disk while it transcribes.
const VIDEO_CONCURRENCY = 4;
const CLASSIFY_ETA_SHARE = 0.35;

type Payload = {
  channelId: string;
  projectId?: string;
  runId: string;
  userId?: string;
  maxVideosPerCompetitor?: number;
  numIdeasPerVideo?: number;
  language?: "en" | "zh";
  // Subset of bound competitor_accounts ids to monitor; omitted = all bound.
  competitorAccountIds?: string[];
  // Unbound competitor_accounts to include just for this run, not as permanent monitor targets.
  extraCompetitorAccountIds?: string[];
  // Video/image filter for XHS + Douyin competitors; YouTube is unaffected.
  contentFilter?: "all" | "video" | "image";
  // Legacy name for contentFilter — read as fallback for in-flight payloads.
  xhsContentType?: "all" | "video" | "image";
  // Free-text topic direction/constraints, injected into idea generation as hard rules.
  direction?: string;
  // clerk_sops id chosen as playbook reference (ownership checked at trigger time).
  sopId?: string;
  // "links" patrols exactly the pasted video URLs instead of scanning competitors.
  sourceMode?: "batch" | "links";
  videoUrls?: string[];
};





export const monitorCompetitors = task({
  id: "muse-monitor-competitors",
  queue: userRunsQueue,
  // VIDEO_CONCURRENCY downloads stream straight to disk, so RAM is not the constraint — the
  // second vCPU is, for the ffmpeg chunking that overlapping long audio triggers.
  machine: { preset: "medium-2x" },
  // 4h headroom for 10-20 videos with YouTube CDN throttle (Trigger.dev Hobby).
  maxDuration: 14400,
  run: async (payload: Payload) => {
    const maxVideosPerCompetitor = payload.maxVideosPerCompetitor ?? 10;
    const numIdeasPerVideo = payload.numIdeasPerVideo ?? DEFAULT_NUM_IDEAS;
    const language = payload.language ?? "zh";

    return withMeteredRunDb({ runId: payload.runId, userId: payload.userId, feature: "muse-monitor-competitors" }, async (db) => {
      const [channel] = await db
        .select()
        .from(channels)
        .where(eq(channels.id, payload.channelId))
        .limit(1);
      if (!channel) throw new Error(`channel ${payload.channelId} not found`);
      const projectId = payload.projectId ?? channel.id;
      const linksMode = payload.sourceMode === "links" && (payload.videoUrls?.length ?? 0) > 0;

      const competitors: Array<{
        competitorAccountId: string | null;
        platform: "youtube" | "xhs" | "douyin";
        url: string;
      }> = [];
      if (!linksMode) {
        // Competitors come from this project's project_competitors bindings.
        const bound = await db
          .select({
            competitorAccountId: competitorAccounts.id,
            platform: competitorAccounts.platform,
            url: competitorAccounts.url,
          })
          .from(projectCompetitors)
          .innerJoin(
            competitorAccounts,
            eq(competitorAccounts.id, projectCompetitors.competitorAccountId),
          )
          .where(
            and(eq(projectCompetitors.projectId, projectId), isNull(competitorAccounts.deletedAt)),
          );
        // Explicit [] means "none of the bound" (extras-only run); undefined means all bound.
        const idFilter = payload.competitorAccountIds
          ? new Set(payload.competitorAccountIds)
          : null;
        competitors.push(
          ...bound
            .map((b) => ({
              competitorAccountId: b.competitorAccountId as string | null,
              platform: b.platform as "youtube" | "xhs" | "douyin",
              url: b.url,
            }))
            .filter(
              (c) => !idFilter || (c.competitorAccountId && idFilter.has(c.competitorAccountId)),
            ),
        );

        // One-off competitors for this run only — not part of the project's permanent bindings.
        const extraIds = (payload.extraCompetitorAccountIds ?? []).filter(
          (id) => !competitors.some((c) => c.competitorAccountId === id),
        );
        if (extraIds.length > 0) {
          const extras = await db
            .select({
              competitorAccountId: competitorAccounts.id,
              platform: competitorAccounts.platform,
              url: competitorAccounts.url,
            })
            .from(competitorAccounts)
            .where(
              and(
                inArray(competitorAccounts.id, extraIds),
                eq(competitorAccounts.userId, channel.userId),
                isNull(competitorAccounts.deletedAt),
              ),
            );
          const known = new Set(competitors.map((c) => c.competitorAccountId));
          for (const e of extras) {
            if (known.has(e.competitorAccountId)) continue;
            known.add(e.competitorAccountId);
            competitors.push({
              competitorAccountId: e.competitorAccountId,
              platform: e.platform as "youtube" | "xhs" | "douyin",
              url: e.url,
            });
          }
          logger.info(`Temp competitors: ${extras.length}/${extraIds.length} resolved for this run`);
        }

        if (competitors.length === 0) {
          throw new Error("This channel has no competitors configured");
        }
        if (idFilter) {
          logger.info(`Competitor selection: ${competitors.length}/${bound.length} bound accounts`);
        }
      }

      // Muse touches both XHS and YouTube competitors; pool is YouTube-only.
      const hasYoutubeCompetitor = linksMode
        ? (payload.videoUrls ?? []).some((l) => detectVideoLinkPlatform(l) === "youtube")
        : competitors.some((c) => c.platform === "youtube");
      let proxyPool: ProxyPool | null = null;
      if (hasYoutubeCompetitor) {
        proxyPool = await loadProxyPool(db, { provider: "wealthproxies" });
        logger.info(
          `Loaded proxy pool: ${proxyPool.size} sessions (${proxyPool.aliveCount} alive)`,
        );
      }

      const channelDescription = channel.description ?? channel.name;

      // Optional: ideas still generate without a bible, just less positioning-aware.
      const resolvedBible = await resolveActiveBible(db, projectId, channel.id);
      // A positioning digest, not the whole bible — its facts are off-limits to Muse.
      const biblePositioning = resolvedBible
        ? selectBibleSections(resolvedBible.bible.content, ["POSITIONING", "AUDIENCE", "CONTENT_RULES"])
        : undefined;
      if (resolvedBible?.viaFallback) {
        logger.warn(`Project ${channel.id} has no Bible pin; used channel active-bible fallback`);
      }

      // Playbook reference is optional; a row deleted since selection just degrades.
      let sopReference: string | undefined;
      if (payload.sopId) {
        const [sopRow] = await db
          .select({ contentMd: clerkSops.contentMd })
          .from(clerkSops)
          .where(eq(clerkSops.id, payload.sopId))
          .limit(1);
        if (sopRow) sopReference = sopRow.contentMd;
        else logger.warn(`Reference SOP ${payload.sopId} not found — generating without it`);
      }

      // Abort if the reaper already settled this queued run — avoid refund + delivery double.
      const [started] = await db
        .update(pipelineRuns)
        .set({ status: "running", startedAt: new Date() })
        .where(and(eq(pipelineRuns.id, payload.runId), ne(pipelineRuns.status, "failed")))
        .returning({ id: pipelineRuns.id });
      if (!started) throw new Error("run already settled (reaped) — aborting to avoid double-deliver");
      await metadata.set("progress", {
        current: 0,
        total: linksMode ? (payload.videoUrls?.length ?? 0) : competitors.length,
        phase: linksMode ? "resolving links" : "resolving competitors",
        detail: linksMode
          ? `解析 ${payload.videoUrls?.length ?? 0} 个指定链接`
          : `共 ${competitors.length} 个对标频道`,
      });

      type Candidate = {
        competitorIndex: number;
        competitorUrl: string;
        competitorAccountId: string | null;
        platform: "youtube" | "xhs" | "douyin";
        videoId: string;
        title: string;
        viewCount?: number;
        duration?: string;
        xhsNote?: XhsNote;
        douyinVideo?: DouyinVideo;
        // Links mode carries the fresh play source so processing skips the detail re-fetch.
        douyinPlay?: DouyinPlaySource;
      };
      const candidates: Candidate[] = [];
      const contentFilter = payload.contentFilter ?? payload.xhsContentType ?? "all";
      // Already-monitored link targets with a usable transcript skip re-fetch/ASR and go
      // straight to idea generation (no runId restamp → no double quota charge).
      const cachedRows: Array<{
        monitorVideoId: string;
        title: string;
        sourceChannelName: string | null;
        views: number;
        durationSec: number;
        transcript: string;
      }> = [];

      if (linksMode) {
        const lines = [...new Set((payload.videoUrls ?? []).map((s) => s.trim()).filter(Boolean))];
        type LinkRef =
          | { platform: "xhs"; videoId: string; xsecToken: string | null }
          | { platform: "douyin"; videoId: string | null; rawUrl: string }
          | { platform: "youtube"; videoId: string };
        const refs: LinkRef[] = [];
        for (const line of lines) {
          try {
            const platform = detectVideoLinkPlatform(line);
            if (platform === "xhs") {
              // Mobile shares are xhslink.com short links; expand first, keep the
              // pasted xsec_token as a fallback for the note URL (mirrors Clerk).
              const expanded = await expandXhsShortLink(line);
              const noteId = extractXhsNoteId(expanded);
              if (noteId) {
                refs.push({ platform: "xhs", videoId: noteId, xsecToken: extractXsecToken(expanded) });
              } else {
                logger.warn(`Not an XHS note link: ${line.slice(0, 120)}`);
              }
            } else if (platform === "douyin") {
              // getDouyinVideoDetail handles short/share URLs itself; id may stay unknown here.
              refs.push({ platform: "douyin", videoId: extractDouyinAwemeId(line), rawUrl: line });
            } else if (platform === "youtube") {
              const videoId = extractYoutubeVideoId(line);
              if (videoId) refs.push({ platform: "youtube", videoId });
              else logger.warn(`Not a YouTube video link: ${line.slice(0, 120)}`);
            } else {
              logger.warn(`Unrecognized link platform: ${line.slice(0, 120)}`);
            }
          } catch (err) {
            logger.warn(
              `Link parse failed: ${line.slice(0, 120)} — ${(err as Error).message?.slice(0, 120)}`,
            );
          }
        }

        const knownIds = [
          ...new Set(refs.map((r) => r.videoId).filter((id): id is string => id !== null)),
        ];
        const cachedRowsById = new Map(
          knownIds.length === 0
            ? []
            : (
                await db
                  .select()
                  .from(museMonitorVideos)
                  .where(
                    and(
                      eq(museMonitorVideos.projectId, projectId),
                      inArray(museMonitorVideos.platformVideoId, knownIds),
                    ),
                  )
              ).map((row) => [row.platformVideoId, row] as const),
        );
        const usableCache = (row: typeof museMonitorVideos.$inferSelect): boolean => {
          if (!row.transcript) return false;
          // Same heuristic as orphan recovery: an [Audio Transcript] marker proves ASR
          // ran (video floor), else the caption may legitimately be short (image floor).
          const floorType = row.transcript.includes("[Audio Transcript]") ? "video" : "xhs_image";
          return isRealTranscript(row.transcript, floorType);
        };
        const reuseCached = async (row: typeof museMonitorVideos.$inferSelect) => {
          if (cachedRows.some((c) => c.monitorVideoId === row.id)) return;
          // The user explicitly asked for this video — a past "irrelevant" verdict doesn't apply.
          if (row.relevant !== true) {
            await db
              .update(museMonitorVideos)
              .set({ relevant: true, rejectionReason: null })
              .where(eq(museMonitorVideos.id, row.id));
          }
          cachedRows.push({
            monitorVideoId: row.id,
            title: row.title,
            sourceChannelName: row.sourceChannelName,
            views: 0,
            durationSec: row.durationSec ?? 0,
            transcript: row.transcript!,
          });
        };

        const pushedIds = new Set<string>();
        let li = 0;
        for (const r of refs) {
          li++;
          await metadata.set("progress", {
            current: li,
            total: refs.length,
            phase: "resolving links",
            detail: `[${li}/${refs.length}] 获取内容详情`,
          });
          try {
            if (r.videoId && pushedIds.has(r.videoId)) continue;
            const hit = r.videoId ? cachedRowsById.get(r.videoId) : undefined;
            if (hit && usableCache(hit)) {
              pushedIds.add(hit.platformVideoId);
              await reuseCached(hit);
              continue;
            }
            if (r.platform === "xhs") {
              const note = await getXhsNoteDetail(r.videoId, r.xsecToken);
              if (note) {
                pushedIds.add(note.noteId);
                candidates.push({
                  competitorIndex: -1,
                  competitorUrl: note.noteUrl,
                  competitorAccountId: null,
                  platform: "xhs",
                  videoId: note.noteId,
                  title: note.title,
                  xhsNote: note,
                });
              } else {
                logger.warn(`XHS note ${r.videoId} not found`);
              }
              await sleep(1100);
            } else if (r.platform === "douyin") {
              const detail = await getDouyinVideoDetail(r.videoId ?? r.rawUrl);
              if (detail) {
                if (pushedIds.has(detail.awemeId)) continue;
                pushedIds.add(detail.awemeId);
                // Share-url resolution may reveal an id whose row is already cached.
                const lateHit = cachedRowsById.get(detail.awemeId);
                if (lateHit && usableCache(lateHit)) {
                  await reuseCached(lateHit);
                } else {
                  candidates.push({
                    competitorIndex: -1,
                    competitorUrl: detail.videoUrl,
                    competitorAccountId: null,
                    platform: "douyin",
                    videoId: detail.awemeId,
                    title: detail.title,
                    douyinVideo: detail,
                    douyinPlay: detail.play,
                  });
                }
              } else {
                logger.warn(`Douyin video not found: ${(r.videoId ?? r.rawUrl).slice(0, 120)}`);
              }
              await sleep(1100);
            } else {
              pushedIds.add(r.videoId);
              candidates.push({
                competitorIndex: -1,
                competitorUrl: `https://www.youtube.com/watch?v=${r.videoId}`,
                competitorAccountId: null,
                platform: "youtube",
                videoId: r.videoId,
                title: r.videoId,
              });
            }
          } catch (err) {
            logger.warn(
              `Link fetch failed: ${(r.videoId ?? "").slice(0, 40)} — ${(err as Error).message?.slice(0, 120)}`,
            );
          }
        }

        if (candidates.length === 0 && cachedRows.length === 0) {
          throw new Error("没有可解析的链接 — 请粘贴内容链接（视频 / 笔记），而不是主页链接");
        }
        logger.info(
          `Links mode: ${lines.length} lines → ${candidates.length} to process, ${cachedRows.length} cached reuse`,
        );
      }

      for (let ci = 0; ci < competitors.length; ci++) {
        const comp = competitors[ci]!;
        await metadata.set("progress", {
          current: ci + 1,
          total: competitors.length,
          phase: "fetching competitor videos",
          detail: `[${ci + 1}/${competitors.length}] ${comp.url}`,
        });
        try {
          if (comp.platform === "xhs") {
            let notes = await getXhsUserNotes(comp.url, maxVideosPerCompetitor);
            if (contentFilter !== "all") {
              notes = notes.filter((n) =>
                contentFilter === "video" ? n.type === "video" : n.type !== "video",
              );
            }
            for (const n of notes) {
              candidates.push({
                competitorIndex: ci,
                competitorUrl: comp.url,
                competitorAccountId: comp.competitorAccountId,
                platform: "xhs",
                videoId: n.noteId,
                title: n.title,
                xhsNote: n,
              });
            }
          } else if (comp.platform === "douyin") {
            const secUid =
              extractDouyinSecUserId(comp.url) ?? (await resolveDouyinUser(comp.url)).secUserId;
            // Over-fetch + newest-first sort so old pinned videos don't crowd out fresh ones.
            const sourced = await getDouyinUserVideos(
              secUid,
              Math.min(60, maxVideosPerCompetitor * 4),
            );
            if (sourced.partial) {
              logger.warn(
                `Competitor ${comp.url}: post list partial (${sourced.videos.length} fetched) — ranking over a truncated window`,
              );
            }
            let videos = sourced.videos;
            videos.sort((a, b) => b.createTime - a.createTime);
            // Filter before truncating: the reverse order can return nothing while the fetched
            // window still holds plenty of matching items.
            if (contentFilter !== "all") {
              videos = videos.filter((v) =>
                contentFilter === "video"
                  ? v.contentType === "douyin_video"
                  : v.contentType === "douyin_image",
              );
            }
            videos = videos.slice(0, maxVideosPerCompetitor);
            for (const v of videos) {
              candidates.push({
                competitorIndex: ci,
                competitorUrl: comp.url,
                competitorAccountId: comp.competitorAccountId,
                platform: "douyin",
                videoId: v.awemeId,
                title: v.title,
                douyinVideo: v,
              });
            }
          } else {
            // YouTube has no image posts, so an image-only run must exclude it rather than
            // silently returning every video as if the filter did not apply.
            if (contentFilter === "image") {
              logger.info(`Competitor ${comp.url}: YouTube has no image posts — skipped by filter`);
              continue;
            }
            if (!proxyPool) {
              logger.warn(`Competitor ${comp.url}: YouTube path needs proxyPool — skipping`);
              continue;
            }
            const videos = await withProxyRetry(proxyPool, (session) =>
              listChannelVideos(comp.url, maxVideosPerCompetitor, session.url, logger),
            );
            for (const v of videos) {
              candidates.push({
                competitorIndex: ci,
                competitorUrl: comp.url,
                competitorAccountId: comp.competitorAccountId,
                platform: "youtube",
                videoId: v.video_id,
                title: v.title,
                viewCount: v.views,
                duration: v.duration_sec ? String(v.duration_sec) : undefined,
              });
            }
          }
        } catch (err) {
          logger.warn(`Competitor ${comp.url} failed: ${(err as Error).message}`);
        }
        await sleep(1000);
      }

      const existing = candidates.length === 0
        ? []
        : await db
            .select({ platformVideoId: museMonitorVideos.platformVideoId })
            .from(museMonitorVideos)
            .where(
              and(
                eq(museMonitorVideos.projectId, projectId),
                inArray(
                  museMonitorVideos.platformVideoId,
                  candidates.map((c) => c.videoId),
                ),
              ),
            );
      const seen = new Set(existing.map((e) => e.platformVideoId));
      // Links mode reprocesses on purpose — cached-usable targets were already diverted,
      // what's left is either new or has an unusable transcript (upsert heals the row).
      const fresh = linksMode ? candidates : candidates.filter((c) => !seen.has(c.videoId));

      logger.info(
        `Found ${candidates.length} candidate videos across ${competitors.length} competitors; ${fresh.length} are new`,
      );

      await db
        .update(pipelineRuns)
        .set({ total: fresh.length, progress: 0 })
        .where(eq(pipelineRuns.id, payload.runId));

      let classified = 0;
      let relevant = 0;
      let skippedShortTranscript = 0;
      const relevantRows: Array<{
        monitorVideoId: string;
        title: string;
        sourceChannelName: string | null;
        views: number;
        durationSec: number;
        transcript: string;
      }> = [];

      // Measured on a 20-video run: classify+ASR 6.4 min vs idea generation 11-12 min once the
      // idea loop runs IDEA_CONCURRENCY-wide. The old 65/35 split had it backwards.
      const etaStart = Date.now();
      const etaField = (frac: number): { estSecondsRemaining?: number } => {
        const el = (Date.now() - etaStart) / 1000;
        return frac > 0.05 ? { estSecondsRemaining: Math.max(0, Math.round(el / frac - el)) } : {};
      };

      // Each video is a download, an ASR call and a classify call — independent, and mostly
      // spent waiting. Progress advances only in finally: mid-item writes from overlapping
      // videos would otherwise walk the bar backwards.
      let completedVideos = 0;
      const videoStep = (phase: string, detail: string) =>
        metadata.set("progress", {
          current: completedVideos,
          total: fresh.length,
          phase,
          detail,
          ...etaField((CLASSIFY_ETA_SHARE * completedVideos) / fresh.length),
        });
      const videoLimit = pLimit(VIDEO_CONCURRENCY);
      await Promise.all(
        fresh.map((ref) =>
          videoLimit(async () => {
            await videoStep(
              "fetching video metadata",
              `[${completedVideos}/${fresh.length}] ${ref.title}`,
            );

            try {
              let title: string;
              let views: number;
              let durationSec: number;
              let url: string;
              let sourceChannelName: string | null;
              let finalTranscript: string | null = null;
              let contentType: "video" | "xhs_video" | "xhs_image" | "douyin_video" | "douyin_image" =
                "video";

              if (ref.platform === "douyin") {
                const listItem = ref.douyinVideo!;
                contentType = listItem.contentType;
                title = listItem.title || ref.title || "(untitled)";
                views = listItem.engagementScore;
                durationSec = listItem.durationSec ?? 0;
                url = listItem.videoUrl;
                sourceChannelName = listItem.authorNickname || null;
                const textBase = listItem.desc.trim() || title;

                if (contentType === "douyin_video") {
                  await videoStep(
                    "transcribing audio",
                    `[${completedVideos}/${fresh.length}] ${title} · 抖音音频转写中`,
                  );
                  // List items carry no play URLs (and may omit duration) — fetch the detail
                  // unless link resolution already carried a fresh play source. Mirrors Clerk.
                  const detail = ref.douyinPlay
                    ? { durationSec: listItem.durationSec, play: ref.douyinPlay }
                    : await getDouyinVideoDetail(listItem.awemeId).catch((err: Error) => {
                        logger.warn(
                          `Douyin detail failed for ${listItem.awemeId}: ${err.message?.slice(0, 120)}`,
                        );
                        return null;
                      });
                  if (detail) {
                    durationSec = detail.durationSec ?? durationSec;
                    const streams = buildDouyinAsrStreams(detail.play);
                    const asr =
                      streams.length > 0 && durationSec <= ASR_MAX_DURATION_SEC
                        ? await transcribeFromStreams(streams, {
                            logger,
                            durationSec: durationSec || undefined,
                            tag: `Douyin ${listItem.awemeId}`,
                            preserveOrder: true,
                          })
                        : null;
                    finalTranscript = asr
                      ? `${textBase}\n\n[Audio Transcript]\n${asr.text}`.trim()
                      : textBase || null;
                  } else {
                    finalTranscript = textBase || null;
                  }
                } else {
                  finalTranscript = textBase || null;
                }
              } else if (ref.platform === "xhs") {
                const note = ref.xhsNote!;
                contentType = note.type === "video" ? "xhs_video" : "xhs_image";
                title = note.title || ref.title || "(untitled)";
                views = note.engagementScore;
                durationSec = note.durationSec ?? 0;
                url = note.noteUrl;
                sourceChannelName = note.channelName || null;

                const titleAndDesc = [note.title, note.desc]
                  .filter((s) => s.trim().length > 0)
                  .join("\n\n");

                if (
                  note.type === "video" &&
                  note.videoStreams.length > 0 &&
                  note.durationSec &&
                  note.durationSec <= ASR_MAX_DURATION_SEC
                ) {
                  await videoStep(
                    "transcribing audio",
                    `[${completedVideos}/${fresh.length}] ${note.title} · XHS 音频转写中`,
                  );
                  const asr = await transcribeFromStreams(
                    note.videoStreams.map((s) => ({
                      url: s.masterUrl,
                      mimeType: "video/mp4",
                      sizeHint: s.size,
                      label: `${s.codec} ${s.width}x${s.height}`,
                    })),
                    {
                      logger,
                      durationSec: note.durationSec ?? undefined,
                      tag: `XHS ${note.noteId}`,
                    },
                  );
                  finalTranscript = asr
                    ? `${titleAndDesc}\n\n[Audio Transcript]\n${asr.text}`.trim()
                    : titleAndDesc || null;
                } else {
                  finalTranscript = titleAndDesc || null;
                }
              } else {
                if (!proxyPool) {
                  throw new Error("YouTube path requires proxyPool — not loaded");
                }
                // Metadata is enrichment only — degrade to null instead of failing the video.
                const info = await withProxyRetry(
                  proxyPool,
                  (session) => getVideoMetadataYtdlp(ref.videoId, session.url),
                  { attempts: 3, okBytes: 10_000 },
                ).catch((err: Error) => {
                  logger.warn(`yt-dlp metadata failed for ${ref.videoId}: ${err.message?.slice(0, 120)}`);
                  return null;
                });

                const candidateDuration =
                  asPositiveNumber(info?.duration_sec ?? null) ??
                  asPositiveNumber(parseDurationToSec(ref.duration)) ??
                  0;
                if (candidateDuration === 0 || candidateDuration <= ASR_MAX_DURATION_SEC) {
                  await videoStep(
                    "transcribing audio",
                    `[${completedVideos}/${fresh.length}] ${ref.title} · 抓字幕或音频转写中`,
                  );
                  const asr = await transcribeYoutubeVideo(ref.videoId, proxyPool, {
                    logger,
                    durationSec: candidateDuration || undefined,
                    qwenFirst: likelyChineseText(ref.title),
                  });
                  if (asr) {
                    finalTranscript = renderTranscriptWithTimestamps(asr.text, asr.words);
                  }
                }

                title = safeText(info?.title ?? null) ?? safeText(ref.title) ?? "(untitled)";
                views = asPositiveNumber(info?.views ?? null) ?? asPositiveNumber(ref.viewCount) ?? 0;
                durationSec = candidateDuration;
                url = safeText(info?.url ?? null) ?? `https://www.youtube.com/watch?v=${ref.videoId}`;
                sourceChannelName = safeText(info?.channel_name ?? null) ?? null;
              }

              await videoStep(
                "classifying video",
                `[${completedVideos}/${fresh.length}] ${ref.title} · AI 分类中`,
              );
              // Analysis follows the SOURCE language — forcing a zh read of an English video
              // translates and distorts it; idea generation uses the user's target language.
              const sourceLang = likelyChineseText(
                (finalTranscript && finalTranscript.trim()) || title,
              )
                ? "zh"
                : "en";
              const cls = await classifyVideo({
                channelDescription,
                title,
                channelName: sourceChannelName ?? "(unknown)",
                views,
                durationSec,
                transcript: finalTranscript,
                language: sourceLang,
              });
              // User-specified links skip the relevance filter — but only if there is something to
              // ideate from. Marking a too-short transcript relevant just parks it as an orphan for
              // the next batch patrol to pick up under a looser floor.
              const relevantVerdict = linksMode
                ? Boolean(finalTranscript && isRealTranscript(finalTranscript, contentType))
                : cls.relevant;

              const [inserted] = await db
                .insert(museMonitorVideos)
                .values({
                  channelId: channel.id,
                  projectId,
                  competitorAccountId: ref.competitorAccountId,
                  platformVideoId: ref.videoId,
                  title,
                  url,
                  sourceChannelName,
                  durationSec: durationSec || null,
                  transcript: safeText(finalTranscript),
                  relevant: relevantVerdict,
                  topicClassification: safeText(cls.topic_classification),
                  rejectionReason: linksMode ? null : safeText(cls.rejection_reason),
                  runId: payload.runId,
                })
                .onConflictDoUpdate({
                  target: [museMonitorVideos.projectId, museMonitorVideos.platformVideoId],
                  set: {
                    projectId,
                    competitorAccountId: ref.competitorAccountId,
                    relevant: relevantVerdict,
                    topicClassification: safeText(cls.topic_classification),
                    rejectionReason: linksMode ? null : safeText(cls.rejection_reason),
                    transcript: safeText(finalTranscript),
                    runId: payload.runId,
                  },
                })
                .returning({ id: museMonitorVideos.id });

              classified++;
              if (relevantVerdict && inserted) {
                relevant++;
                if (finalTranscript && isRealTranscript(finalTranscript, contentType)) {
                  relevantRows.push({
                    monitorVideoId: inserted.id,
                    title,
                    sourceChannelName,
                    views,
                    durationSec,
                    transcript: finalTranscript,
                  });
                } else {
                  skippedShortTranscript++;
                  logger.warn(
                    `Video ${ref.videoId} ("${title}") marked relevant but transcript ${
                      finalTranscript ? `only ${finalTranscript.length} chars` : "missing"
                    } — skipping idea gen`,
                  );
                }
              }

              await db
                .update(pipelineRuns)
                .set({ progress: classified })
                .where(eq(pipelineRuns.id, payload.runId));
            } catch (err) {
              logger.error(`Video ${ref.videoId} failed`, {
                message: (err as Error).message?.slice(0, 500),
              });
            } finally {
              completedVideos++;
              await videoStep(
                "classifying video",
                `[${completedVideos}/${fresh.length}] ${ref.title}`,
              );
            }
          }),
        ),
      );

      // Recovery: pull DB rows that are relevant but never got ideas (prior
      // run killed by MAX_DURATION_EXCEEDED before idea-gen). Scope to projectId
      // (not channelId) so a sibling project's content isn't pulled in.
      // Links mode skips it — the user named exactly which videos to process.
      const alreadyIdeated = linksMode
        ? []
        : await db
            .select({ id: museIdeas.sourceVideoId })
            .from(museIdeas)
            .where(eq(museIdeas.projectId, projectId));
      const ideatedIds = alreadyIdeated
        .map((r) => r.id)
        .filter((id): id is string => id !== null);
      const orphans = linksMode
        ? []
        : await db
            .select({
              monitorVideoId: museMonitorVideos.id,
              title: museMonitorVideos.title,
              sourceChannelName: museMonitorVideos.sourceChannelName,
              durationSec: museMonitorVideos.durationSec,
              transcript: museMonitorVideos.transcript,
            })
            .from(museMonitorVideos)
            .where(
              and(
                eq(museMonitorVideos.projectId, projectId),
                eq(museMonitorVideos.relevant, true),
                ideatedIds.length > 0
                  ? notInArray(museMonitorVideos.id, ideatedIds)
                  : undefined,
              ),
            );
      const inMemoryIds = new Set(relevantRows.map((r) => r.monitorVideoId));
      for (const o of orphans) {
        if (inMemoryIds.has(o.monitorVideoId)) continue;
        // No contentType column on this table: an [Audio Transcript] marker proves ASR ran
        // (video floor); otherwise the row may be an image post whose caption legitimately
        // sits in the 50-199 char band — the image floor keeps it from being skipped forever.
        const floorType = o.transcript?.includes("[Audio Transcript]") ? "video" : "xhs_image";
        if (!o.transcript || !isRealTranscript(o.transcript, floorType)) continue;
        relevantRows.push({
          monitorVideoId: o.monitorVideoId,
          title: o.title,
          sourceChannelName: o.sourceChannelName,
          // views isn't persisted; prompts tolerate 0 on recovery path.
          views: 0,
          durationSec: o.durationSec ?? 0,
          transcript: o.transcript,
        });
      }
      if (orphans.length > 0) {
        logger.info(
          `Recovered ${orphans.length} orphan relevant videos missing ideas from prior runs`,
        );
      }

      // Cached link targets (transcript reused, no re-fetch) join the idea queue here.
      relevantRows.push(...cachedRows);

      let ideasGenerated = 0;
      // Seed past the project's max so re-ideating a video never collides with
      // unique(source_video_id, idea_number) and gets dropped by onConflictDoNothing.
      const [maxIdea] = await db
        .select({ max: sql<number | null>`max(${museIdeas.ideaNumber})` })
        .from(museIdeas)
        .where(eq(museIdeas.projectId, projectId));
      let globalIdeaNumber = Number(maxIdea?.max ?? 0);
      if (relevantRows.length > 0) {
        await metadata.set("progress", {
          current: 0,
          total: relevantRows.length,
          phase: "generating ideas",
          detail: `共 ${relevantRows.length} 个相关视频，开始生成选题`,
          ...etaField(CLASSIFY_ETA_SHARE),
        });

        // Idea generation is ~88% of a batch run's wall clock and rows are independent, so it
        // runs concurrently like the clerk loops. Progress is driven by a completion counter in
        // finally — a per-row index would walk the bar backwards once rows overlap.
        let completedIdeaRows = 0;
        const ideaLimit = pLimit(IDEA_CONCURRENCY);
        await Promise.all(
          relevantRows.map((row) =>
            ideaLimit(async () => {
              try {
                const sourceLang = likelyChineseText(
                  (row.transcript && row.transcript.trim()) || row.title,
                )
                  ? "zh"
                  : "en";
                const viralTrigger = await analyzeViralTrigger({
                  channelDescription,
                  title: row.title,
                  channelName: row.sourceChannelName ?? "(unknown)",
                  views: row.views,
                  durationSec: row.durationSec,
                  transcript: row.transcript,
                  language: sourceLang,
                });

                if (!viralTrigger) {
                  logger.warn(`Empty viral trigger for ${row.title}; skipping idea generation`);
                  return;
                }

                const ideasResult = await generateIdeas({
                  channelDescription,
                  title: row.title,
                  channelName: row.sourceChannelName ?? "(unknown)",
                  views: row.views,
                  viralTrigger,
                  numIdeas: numIdeasPerVideo,
                  language,
                  biblePositioning,
                  transcript: row.transcript,
                  direction: payload.direction,
                  sopReference,
                });

                if (ideasResult.ideas.length === 0) {
                  logger.warn(
                    `No ideas parsed for "${row.title}" — raw sample: ${ideasResult.rawSample ?? "(none)"} | validation: ${ideasResult.parseErrorSample ?? "(none)"}`,
                  );
                  return;
                }

                // ++globalIdeaNumber stays safe under concurrency: .map() is synchronous with no
                // await inside, so one row's whole block is allocated without interleaving.
                await db.insert(museIdeas).values(
                  ideasResult.ideas.map((idea) => ({
                    channelId: channel.id,
                    projectId,
                    sourceVideoId: row.monitorVideoId,
                    ideaNumber: ++globalIdeaNumber,
                    storyAngle: safeText(idea.story_angle),
                    factsAndData: safeText(idea.facts_and_data),
                    whySimilar: safeText(idea.why_similar),
                    viralTrigger: safeText(idea.viral_trigger) ?? safeText(viralTrigger),
                    coverConcept: safeText(idea.cover_concept),
                    suggestedHookType: safeText(idea.suggested_hook_type),
                    riskFactors: safeText(idea.risk_factors),
                    runId: payload.runId,
                  })),
                ).onConflictDoNothing();
                ideasGenerated += ideasResult.ideas.length;
              } catch (err) {
                logger.error(`Idea generation failed for ${row.title}`, {
                  message: (err as Error).message?.slice(0, 500),
                });
              } finally {
                completedIdeaRows++;
                await metadata.set("progress", {
                  current: completedIdeaRows,
                  total: relevantRows.length,
                  phase: "generating ideas",
                  detail: `[${completedIdeaRows}/${relevantRows.length}] ${row.title}`,
                  ...etaField(
                    CLASSIFY_ETA_SHARE +
                      ((1 - CLASSIFY_ETA_SHARE) * completedIdeaRows) / relevantRows.length,
                  ),
                });
              }
            }),
          ),
        );
      }

      if (proxyPool) {
        const flushed = await flushProxyPool(db, proxyPool);
        const stats = proxyPool.stats();
        logger.info(
          `Pool flushed: ${flushed.updatedSessions} sessions touched, ${flushed.newlyDisabled} newly disabled. ` +
            `alive=${stats.alive}/${stats.total} bytes=${JSON.stringify(stats.bytesByProvider)} ok=${JSON.stringify(stats.okByProvider)} err=${JSON.stringify(stats.errByProvider)}`,
        );
      }

      // Settle parse quota from the videos this run actually stamped (duration-weighted).
      // Cached rows are deliberately not restamped — re-charging the parse of content that was
      // never re-fetched would double-bill. But links mode re-ideates them, and idea generation
      // is two LLM calls per video, so it carries its own flat charge. Without this a repeated
      // link run settles zero and the loop is free.
      if (payload.userId) {
        const processed = await db
          .select({ durationSec: museMonitorVideos.durationSec })
          .from(museMonitorVideos)
          .where(eq(museMonitorVideos.runId, payload.runId));
        const minutes =
          processed.reduce((s, v) => s + videoMinutes(v.durationSec), 0) +
          cachedRows.length * IDEATION_MINUTES;
        await settleRunMinutes(db, { runId: payload.runId, userId: payload.userId, minutes });
      }

      await db
        .update(pipelineRuns)
        .set({ status: "done", completedAt: new Date() })
        .where(eq(pipelineRuns.id, payload.runId));

      return {
        mode: linksMode ? "links" : "batch",
        classified,
        relevant,
        skippedShortTranscript,
        ideasGenerated,
        eligibleForIdeas: relevantRows.length,
        totalCandidates: candidates.length,
        newCandidates: fresh.length,
        competitors: competitors.length,
        ...(linksMode
          ? { linksRequested: payload.videoUrls?.length ?? 0, cachedReused: cachedRows.length }
          : {}),
      };
    });
  },
});
