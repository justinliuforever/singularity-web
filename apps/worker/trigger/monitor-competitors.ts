import { logger, metadata, task } from "@trigger.dev/sdk";
import { and, eq, inArray, isNull, ne, notInArray } from "drizzle-orm";

import {
  channels,
  competitorAccounts,
  settleRunMinutes,
  videoMinutes,
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
  extractDouyinSecUserId,
  getDouyinUserVideos,
  getDouyinVideoDetail,
  resolveDouyinUser,
  type DouyinVideo,
} from "@goooose/integrations/clients/douyin";
import {
  getXhsUserNotes,
  type XhsNote,
} from "@goooose/integrations/clients/xhs";
import { isRealTranscript } from "@goooose/domain/schemas/muse";
import {
  analyzeViralTrigger,
  classifyVideo,
  generateIdeas,
} from "@goooose/domain/services/muse";
import { asPositiveNumber, parseDurationToSec, safeText, sleep } from "@goooose/integrations/utils";

const ASR_MAX_DURATION_SEC = 60 * 60;
const DEFAULT_NUM_IDEAS = 5;

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
  // Unbound competitor_accounts to include just for this run (not permanent 巡视对象).
  extraCompetitorAccountIds?: string[];
  // Video/image filter for XHS + Douyin competitors; YouTube is unaffected.
  contentFilter?: "all" | "video" | "image";
  // Legacy name for contentFilter — read as fallback for in-flight payloads.
  xhsContentType?: "all" | "video" | "image";
};





export const monitorCompetitors = task({
  id: "muse-monitor-competitors",
  queue: userRunsQueue,
  // Serial per-video pipeline (I/O + LLM bound); one audio buffer at a time fits medium-1x's 2GB.
  machine: { preset: "medium-1x" },
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
      const idFilter = payload.competitorAccountIds ? new Set(payload.competitorAccountIds) : null;
      const competitors: Array<{
        competitorAccountId: string | null;
        platform: "youtube" | "xhs" | "douyin";
        url: string;
      }> = bound
        .map((b) => ({
          competitorAccountId: b.competitorAccountId,
          platform: b.platform as "youtube" | "xhs" | "douyin",
          url: b.url,
        }))
        .filter((c) => !idFilter || (c.competitorAccountId && idFilter.has(c.competitorAccountId)));

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

      // Muse touches both XHS and YouTube competitors; pool is YouTube-only.
      const hasYoutubeCompetitor = competitors.some((c) => c.platform === "youtube");
      let proxyPool: ProxyPool | null = null;
      if (hasYoutubeCompetitor) {
        proxyPool = await loadProxyPool(db, { provider: "wealthproxies" });
        logger.info(
          `Loaded proxy pool: ${proxyPool.size} sessions (${proxyPool.aliveCount} alive)`,
        );
      }

      const channelDescription = channel.description ?? channel.name;

      // Bible is optional here — ideas still generate without it, just less positioning-aware.
      const resolvedBible = await resolveActiveBible(db, projectId, channel.id);
      // Muse needs a positioning digest, not the whole bible (facts there are off-limits anyway).
      const biblePositioning = resolvedBible
        ? selectBibleSections(resolvedBible.bible.content, ["POSITIONING", "AUDIENCE", "CONTENT_RULES"])
        : undefined;
      if (resolvedBible?.viaFallback) {
        logger.warn(`Project ${channel.id} has no Bible pin; used channel active-bible fallback`);
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
        total: competitors.length,
        phase: "resolving competitors",
        detail: `共 ${competitors.length} 个对标频道`,
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
      };
      const candidates: Candidate[] = [];
      const contentFilter = payload.contentFilter ?? payload.xhsContentType ?? "all";

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
            let videos = await getDouyinUserVideos(secUid, Math.min(60, maxVideosPerCompetitor * 4));
            videos.sort((a, b) => b.createTime - a.createTime);
            videos = videos.slice(0, maxVideosPerCompetitor);
            if (contentFilter !== "all") {
              videos = videos.filter((v) =>
                contentFilter === "video"
                  ? v.contentType === "douyin_video"
                  : v.contentType === "douyin_image",
              );
            }
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
      const fresh = candidates.filter((c) => !seen.has(c.videoId));

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

      // Stage-weighted live ETA: extrapolate remaining time from elapsed /
      // weighted-progress so the classify→idea-gen boundary doesn't reset. Classify (with ASR)
      // is ~65% of the timeline; serial loop so this is a sound estimator.
      const etaStart = Date.now();
      const etaField = (frac: number): { estSecondsRemaining?: number } => {
        const el = (Date.now() - etaStart) / 1000;
        return frac > 0.05 ? { estSecondsRemaining: Math.max(0, Math.round(el / frac - el)) } : {};
      };

      for (let i = 0; i < fresh.length; i++) {
        const ref = fresh[i]!;
        const stepBase = { current: i + 1, total: fresh.length };
        await metadata.set("progress", {
          ...stepBase,
          phase: "fetching video metadata",
          detail: `[${i + 1}/${fresh.length}] ${ref.title}`,
          ...etaField((0.65 * i) / fresh.length),
        });

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
              await metadata.set("progress", {
                ...stepBase,
                phase: "transcribing audio",
                detail: `[${i + 1}/${fresh.length}] ${title} · 抖音音频转写中`,
              });
              // List items carry no play URLs (and may omit duration) — always fetch the
              // detail; it has fresh URLs plus the authoritative duration. Mirrors Clerk.
              const detail = await getDouyinVideoDetail(listItem.awemeId).catch((err: Error) => {
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
              await metadata.set("progress", {
                ...stepBase,
                phase: "transcribing audio",
                detail: `[${i + 1}/${fresh.length}] ${note.title} · XHS 音频转写中`,
              });
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
              await metadata.set("progress", {
                ...stepBase,
                phase: "transcribing audio",
                detail: `[${i + 1}/${fresh.length}] ${ref.title} · 抓字幕或音频转写中`,
              });
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

          await metadata.set("progress", {
            ...stepBase,
            phase: "classifying video",
            detail: `[${i + 1}/${fresh.length}] ${ref.title} · AI 分类中`,
          });
          // Two-axis language: analysis follows the SOURCE language (forcing a zh read of an
          // English video translates+distorts), while idea generation uses the user's target
          // language. Detect per video from the transcript (fallback title).
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
              relevant: cls.relevant,
              topicClassification: safeText(cls.topic_classification),
              rejectionReason: safeText(cls.rejection_reason),
              runId: payload.runId,
            })
            .onConflictDoUpdate({
              target: [museMonitorVideos.projectId, museMonitorVideos.platformVideoId],
              set: {
                projectId,
                competitorAccountId: ref.competitorAccountId,
                relevant: cls.relevant,
                topicClassification: safeText(cls.topic_classification),
                rejectionReason: safeText(cls.rejection_reason),
                transcript: safeText(finalTranscript),
                runId: payload.runId,
              },
            })
            .returning({ id: museMonitorVideos.id });

          classified++;
          if (cls.relevant && inserted) {
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
              // Classifier said relevant but transcript is missing or too short;
              // viral-trigger + idea gen need real content, so we can't proceed.
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
        }
        if (i < fresh.length - 1) await sleep(1500);
      }

      // Recovery: pull DB rows that are relevant but never got ideas (prior
      // run killed by MAX_DURATION_EXCEEDED before idea-gen). Scope to projectId
      // (not channelId) so a sibling project's content isn't pulled in.
      const alreadyIdeated = await db
        .select({ id: museIdeas.sourceVideoId })
        .from(museIdeas)
        .where(eq(museIdeas.projectId, projectId));
      const ideatedIds = alreadyIdeated
        .map((r) => r.id)
        .filter((id): id is string => id !== null);
      const orphans = await db
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
        // Use the same real-transcript gate as the main path (content type isn't
        // persisted, so apply the stricter video floor) — don't feed 50-199 char
        // garbage/partial ASR into idea generation.
        // No contentType column on this table: an [Audio Transcript] marker proves ASR ran
        // (video floor); otherwise the row may be an image post whose caption legitimately
        // sits in the 50-199 char band — use the image floor so it isn't skipped forever.
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

      let ideasGenerated = 0;
      let globalIdeaNumber = 0;
      if (relevantRows.length > 0) {
        await metadata.set("progress", {
          current: 0,
          total: relevantRows.length,
          phase: "generating ideas",
          detail: `共 ${relevantRows.length} 个相关视频，开始生成选题`,
          ...etaField(0.65),
        });

        for (let i = 0; i < relevantRows.length; i++) {
          const row = relevantRows[i]!;
          const stepBase = { current: i + 1, total: relevantRows.length };
          await metadata.set("progress", {
            ...stepBase,
            phase: "analyzing viral trigger",
            detail: `[${i + 1}/${relevantRows.length}] ${row.title} · 分析爆款触发因素`,
            ...etaField(0.65 + (0.35 * i) / relevantRows.length),
          });
          try {
            // Analysis follows the source language (faithful); ideas below use the target.
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
              continue;
            }

            await metadata.set("progress", {
              ...stepBase,
              phase: "generating ideas",
              detail: `[${i + 1}/${relevantRows.length}] ${row.title} · 生成 ${numIdeasPerVideo} 个选题`,
              ...etaField(0.65 + (0.35 * i) / relevantRows.length),
            });
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
            });

            if (ideasResult.ideas.length === 0) {
              logger.warn(
                `No ideas parsed for "${row.title}" — raw sample: ${ideasResult.rawSample ?? "(none)"} | validation: ${ideasResult.parseErrorSample ?? "(none)"}`,
              );
              continue;
            }

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
          }
          if (i < relevantRows.length - 1) await sleep(1500);
        }
      }

      if (proxyPool) {
        const flushed = await flushProxyPool(db, proxyPool);
        const stats = proxyPool.stats();
        logger.info(
          `Pool flushed: ${flushed.updatedSessions} sessions touched, ${flushed.newlyDisabled} newly disabled. ` +
            `alive=${stats.alive}/${stats.total} bytes=${JSON.stringify(stats.bytesByProvider)} ok=${JSON.stringify(stats.okByProvider)} err=${JSON.stringify(stats.errByProvider)}`,
        );
      }

      // Settle 解析额度 from the videos this run actually stamped (duration-weighted).
      if (payload.userId) {
        const processed = await db
          .select({ durationSec: museMonitorVideos.durationSec })
          .from(museMonitorVideos)
          .where(eq(museMonitorVideos.runId, payload.runId));
        const minutes = processed.reduce((s, v) => s + videoMinutes(v.durationSec), 0);
        await settleRunMinutes(db, { runId: payload.runId, userId: payload.userId, minutes });
      }

      await db
        .update(pipelineRuns)
        .set({ status: "done", completedAt: new Date() })
        .where(eq(pipelineRuns.id, payload.runId));

      return {
        classified,
        relevant,
        skippedShortTranscript,
        ideasGenerated,
        eligibleForIdeas: relevantRows.length,
        totalCandidates: candidates.length,
        newCandidates: fresh.length,
        competitors: competitors.length,
      };
    });
  },
});
