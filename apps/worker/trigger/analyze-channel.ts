import { logger, metadata, task } from "@trigger.dev/sdk";
import { generateText } from "ai";
import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import pLimit from "p-limit";

import {
  channels,
  clerkSops,
  clerkVideos,
  competitorAccounts,
  settleRunMinutes,
  videoMinutes,
  flushProxyPool,
  loadProxyPool,
  pipelineRuns,
  projectSops,
} from "@goooose/db";

import { withMeteredRunDb } from "../lib/metered-run";
import { userRunsQueue } from "../lib/queues";
import { llm } from "@goooose/integrations/clients/llm";
import { summarizeVideoForSop } from "@goooose/domain/services/clerk-map";
import { redactUngrounded } from "@goooose/domain/services/grounding";
import { withProxyRetry, type ProxyPool } from "@goooose/integrations/proxy";
import {
  buildAiSopReferencePrompt,
  buildHottestSopPrompt,
  buildImagePostSopPrompt,
  buildHumanSopPrompt,
  buildSopPartialReducePrompt,
  buildVideoAnalysisPrompt,
} from "@goooose/prompts/clerk";
import {
  buildCommentsSummaryPrompt,
  type CommentsSummary,
} from "@goooose/prompts/clerk-comments";
import { clerkAnalysisSchema, clerkAnalysisToDbRow } from "@goooose/domain/schemas/clerk";
import {
  fetchVideoMetadataBatch,
  type YoutubeVideoMeta,
} from "@goooose/integrations/clients/youtube-data";
import {
  likelyChineseText,
  renderTranscriptWithTimestamps,
  stripAdSegments,
  transcribeFromStreams,
  transcribeYoutubeVideo,
} from "@goooose/integrations/clients/asr";
import {
  getTopCommentsYtdlp,
  getVideoMetadataYtdlp,
  listChannelVideos,
  type YtdlpChannelVideo,
  type YtdlpVideoMetadata,
} from "@goooose/integrations/clients/ytdlp";
import { analyzeImageStack, analyzeThumbnail } from "@goooose/integrations/clients/vision";
import {
  buildDouyinAsrStreams,
  expandDouyinShortLink,
  extractDouyinAwemeId,
  extractDouyinSecUserId,
  getDouyinTopComments,
  getDouyinUserVideos,
  getDouyinVideoDetail,
  resolveDouyinUser,
  type DouyinPlaySource,
  type DouyinVideo,
} from "@goooose/integrations/clients/douyin";
import {
  expandXhsShortLink,
  extractXhsNoteId,
  extractXsecToken,
  getXhsNoteDetail,
  getXhsUserNotes,
  type XhsNote,
} from "@goooose/integrations/clients/xhs";
import { asPositiveNumber, parseDurationToSec, parseLlmJson, safeText, sleep } from "@goooose/integrations/utils";

// Skip ASR for videos > 60 min: audio nearly always exceeds Groq's 25 MB cap.
const ASR_MAX_DURATION_SEC = 60 * 60;

type Payload = {
  channelId?: string;
  competitorAccountId?: string;
  runId: string;
  userId?: string;
  limit?: number;
  language?: "en" | "zh";
  mode?: "overwrite" | "incremental";
  source?: "newest" | "popular" | "urls";
  videoIds?: string[];
  recencyMonths?: 1 | 3 | 6 | null;
};

// Stamped on every clerk_videos/clerk_sops row this run writes, derived once so run and content can't drift.
type RunOwner = {
  channelId: string | null;
  ownAccountId: string | null;
  competitorAccountId: string | null;
};

type ClerkContentType = "video" | "xhs_image" | "xhs_video" | "douyin_image" | "douyin_video";

type ResolvedClerkItem = {
  platformVideoId: string;
  title: string;
  views: number | null;
  durationSec: number | null;
  url: string;
  thumbnailUrl: string | null;
  contentType: ClerkContentType;
  sourceChannelName: string | null;
  sourceChannelId: string | null;
  transcript: string | null;
  transcriptSource: string;
  visionUrls: string[];
};

function extractYoutubeVideoIdLocal(input: string): string | null {
  const s = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  // Pasted text wraps the URL in title/emoji, so new URL() throws — scan for an embedded id
  // first, anchored to its URL context so an arbitrary 11-char substring can't false-match.
  const embedded =
    s.match(/[?&]v=([A-Za-z0-9_-]{11})/) ??
    s.match(/(?:youtu\.be|\/shorts|\/live|\/embed|\/v)\/([A-Za-z0-9_-]{11})/);
  if (embedded) return embedded[1]!;
  try {
    const parsed = new URL(s);
    if (parsed.hostname.includes("youtu.be")) {
      const id = parsed.pathname.replace(/^\//, "").slice(0, 11);
      if (/^[A-Za-z0-9_-]{11}$/.test(id)) return id;
    }
    if (parsed.hostname.includes("youtube.com")) {
      if (parsed.pathname.replace(/\/$/, "") === "/watch") {
        const v = parsed.searchParams.get("v") ?? "";
        if (/^[A-Za-z0-9_-]{11}$/.test(v)) return v;
      }
      const m = parsed.pathname.match(/\/(?:shorts|live|embed|v)\/([A-Za-z0-9_-]{11})/);
      if (m) return m[1]!;
    }
  } catch {
    /* fall through */
  }
  return null;
}





type SelectedVideoRef = {
  video_id: string;
  title: string;
  url?: string;
  view_count?: number;
  duration?: string;
  thumbnail?: string;
};

type ResolvedVideoMeta = {
  title: string;
  url: string;
  views: number | null;
  durationSec: number | null;
  thumbnailUrl: string | null;
  sourceChannelName: string | null;
  sourceChannelId: string | null;
};

function resolveVideoMeta(args: {
  yt: YoutubeVideoMeta | null;
  info: YtdlpVideoMetadata | null;
  ref: SelectedVideoRef;
  videoId: string;
}): ResolvedVideoMeta {
  const { yt, info, ref, videoId } = args;
  return {
    title:
      safeText(yt?.title) ??
      safeText(info?.title) ??
      safeText(ref.title === videoId ? null : ref.title) ??
      "(untitled)",
    url:
      safeText(info?.url) ?? safeText(ref.url) ?? `https://www.youtube.com/watch?v=${videoId}`,
    views:
      yt?.viewCount ??
      asPositiveNumber(info?.views) ??
      asPositiveNumber(ref.view_count) ??
      null,
    durationSec:
      yt?.durationSec ??
      asPositiveNumber(info?.duration_sec) ??
      asPositiveNumber(parseDurationToSec(ref.duration)) ??
      null,
    thumbnailUrl:
      safeText(yt?.thumbnailUrl) ??
      safeText(info?.thumbnail_url) ??
      safeText(ref.thumbnail) ??
      null,
    sourceChannelName: safeText(yt?.channelTitle) ?? safeText(info?.channel_name ?? null),
    sourceChannelId: safeText(yt?.channelId) ?? safeText(info?.channel_id ?? null),
  };
}

function renderVideoAnalysisFields(v: typeof clerkVideos.$inferSelect): string {
  const fields: Array<[string, string | null]> = [
    ["opening_hook_type", v.openingHookType],
    ["opening_hook", v.openingHook],
    ["hooks_throughout", v.hooksThroughout],
    ["all_hook_types", v.allHookTypes],
    ["text_hook", v.textHook],
    ["framework", v.framework],
    ["opening_structure", v.openingStructure],
    ["script_structure", v.scriptStructure],
    ["storytelling_framework", v.storytellingFramework],
    ["rehooks_used", v.rehooksUsed],
    ["retention_pattern", v.retentionPattern],
    ["cta_placement", v.ctaPlacement],
    ["key_takeaways", v.keyTakeaways],
    ["cover_diagnosis", v.coverDiagnosis],
  ];
  const lines = fields.filter(([, val]) => val).map(([k, val]) => `- ${k}: ${val}`);
  // cover_title_suggestions is deliberately absent: those vision-generated alt titles seeded
  // fabricated specifics in the SOP map/reduce (still stored on the row and shown in the UI).
  return lines.join("\n");
}

const VIDEOS_SUMMARY_NOTE =
  `GROUNDING — write the SOP only from the per-video pattern summaries below. Each summary already distills one video's grounded techniques; never quote lines, cite [m:ss], invent a beat-by-beat structure, or assert per-video frequency counts beyond what the summaries state. Put a phrase in quotation marks with a [Video N] / [Post N] citation (match the block's own label) ONLY if it appears verbatim in a summary; paraphrase or inference takes no quotes and no citation. When writing in Chinese, refer to blocks labeled "Post N (image note)" as 帖子N（图文） and "Post N (video note)" as 帖子N（视频）, never as 视频N. If a video has no pattern summary, infer only from its title and label it inference. If most videos lack spoken detail, say so plainly and keep the SOP at the title/cover-pattern level instead of fabricating depth.

COVER RULES — a block's "Cover (vision)" lines are a first-hand read of that post's actual cover image. These rules apply in EVERY section and appendix, and override anything that conflicts with them:
1. A post whose block carries no "Cover (vision)" line had no cover analysis. Say so plainly. Never state what its cover shows, and never fill the gap from its title, its transcript, or another post's cover. The "infer from the title" allowance above covers the pattern summary ONLY — a missing pattern summary does not turn a present Cover line into an inference.
2. Cover text may be quoted only from a "Cover (vision)" line, copied character-for-character. A post's title is NOT its cover text; they are different strings and often unrelated. Never present a title as cover copy.
3. Invent no figures — no colour codes, no percentage of frame, no line-count caps, no cadences — unless that exact figure appears in a Cover line. If reads disagree on a figure, say it varies; never average them into a range.
4. Open the cover section by stating the evidence base: which posts have a cover read and which do not, before any channel-wide rule.
5. Never state a cover pattern as a fraction or with 所有/全部/多数/一律/必须. Name the posts you observed it in, and in the same breath name any post whose read lacks it or differs, and how. One element per claim — never bundle two elements to make a pattern look stronger.
6. Every cover claim, anywhere in the SOP, must name its posts in full 帖子N（视频）/帖子N（图文） form — including inside lists and tables. Before naming a post, confirm the element is in that post's own read, worded as that read words it: if the read says yellow TEXT, do not write yellow BACKGROUND. Drop posts that do not check out; drop the claim if none survives.
7. If a Cover line hedges an element (看不清 / 疑似 / 无法确认), it is not established. Never assert it as a pattern, prop, or rule.
8. Do not attach a descriptor to posts whose reads lack it. If one read says 圆框 and another 细框, the shared claim is 眼镜 — describe the common denominator or split the claim per post.
9. Cover facts describe the cover only. Never carry them into the video body, and never present cover copy as a spoken line, a script opening, or an in-video beat.\n\n`;

function renderVideoSummaryBlock(
  v: typeof clerkVideos.$inferSelect,
  summaries: Map<string, string>,
  index: number,
): string {
  const lines: string[] = [];
  // The Chinese citation form is embedded in the label because a prose rule telling the model to
  // map "Post N (video note)" → 帖子N（视频） was ignored in 7 of 8 measured runs.
  const label =
    v.contentType === "xhs_image"
      ? `Post ${index} (image note) [cite in Chinese as 帖子${index}（图文）]`
      : v.contentType === "xhs_video"
        ? `Post ${index} (video note) [cite in Chinese as 帖子${index}（视频）]`
        : v.contentType === "douyin_image"
          ? `Post ${index} (Douyin image carousel) [cite in Chinese as 帖子${index}（图文）]`
          : v.contentType === "douyin_video"
            ? `Video ${index} (Douyin) [cite in Chinese as 视频${index}]`
            : `Video ${index}`;
  lines.push(`### ${label}: "${v.title || "(untitled)"}"`);
  lines.push(`- Views: ${v.views?.toLocaleString("en-US") ?? "unknown"}`);
  lines.push(`- Duration: ${v.durationSec ?? "unknown"}s`);
  lines.push(`- Transcript source: ${v.transcriptSource ?? "none"}`);
  // cover_vision_at records that an image was actually read; the other two are legacy signals for
  // older rows — gating on them alone reported real multi-image reads as "no cover analysis".
  // Injected verbatim because the MAP step only paraphrases.
  if (v.coverVisionAt || v.coverDiagnosis || v.coverTitleSuggestions?.length) {
    if (v.thumbnailDescription) lines.push(`- Cover (vision) — what this post's own cover image shows: ${v.thumbnailDescription}`);
    if (v.thumbnailWhyItWorks) lines.push(`- Cover (vision) — why it works: ${v.thumbnailWhyItWorks}`);
    if (v.coverDiagnosis) lines.push(`- Cover (vision) — weakest point: ${v.coverDiagnosis}`);
  }
  const summary = summaries.get(v.id);
  lines.push(summary ? `\n${summary}` : "- (no pattern summary available for this video)");
  return lines.join("\n");
}

function buildVideosSummaryText(
  videos: Array<typeof clerkVideos.$inferSelect>,
  summaries: Map<string, string>,
): string {
  const blocks = videos.map((v, i) => renderVideoSummaryBlock(v, summaries, i + 1));
  return VIDEOS_SUMMARY_NOTE + blocks.join("\n\n");
}

// Chars, not tokens: a safe slice of DeepSeek V4 Pro's ~64k-token window, leaving room for the
// SOP template + 16k output. Over budget → hierarchical reduce, which drops no video.
const REDUCE_CHAR_BUDGET = 80_000;
// Below the budget so each partial-reduce call keeps headroom for its own prompt + output.
const REDUCE_CHUNK_BUDGET = 55_000;
// One level covers hundreds of videos; the cap only guards pathological input — blocks pass
// through unreduced rather than being truncated.
const REDUCE_MAX_RECURSION = 2;

// A block larger than the budget becomes its own chunk rather than being dropped.
function packBlocksIntoChunks(blocks: string[], chunkBudget: number): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let currentLen = 0;
  for (const block of blocks) {
    const blockLen = block.length + 2; // "\n\n" join cost
    if (current.length > 0 && currentLen + blockLen > chunkBudget) {
      chunks.push(current);
      current = [];
      currentLen = 0;
    }
    current.push(block);
    currentLen += blockLen;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

async function reduceOneChunk(args: {
  chunkText: string;
  language: "en" | "zh";
  chunkLabel: string;
}): Promise<string> {
  try {
    const prompt = buildSopPartialReducePrompt({
      videosData: args.chunkText,
      language: args.language,
    });
    const result = await generateText({
      model: llm("pro"),
      prompt,
      maxOutputTokens: 4096,
      temperature: 0.4,
      maxRetries: 2,
    });
    const cleaned = safeText(result.text);
    if (cleaned) return cleaned;
    logger.warn(
      `SOP partial reduce ${args.chunkLabel}: empty response — falling back to raw chunk summaries`,
    );
  } catch (err) {
    logger.warn(
      `SOP partial reduce ${args.chunkLabel} failed (${(err as Error).message?.slice(0, 120)}) — falling back to raw chunk summaries`,
    );
  }
  return args.chunkText;
}

// Never drops a block: over budget → pack into chunks, partial-reduce concurrently, recurse.
async function buildReducedVideosData(args: {
  blocks: string[];
  language: "en" | "zh";
  videoCount: number;
  limitFn: <T>(fn: () => Promise<T>) => Promise<T>;
  depth?: number;
}): Promise<string> {
  const { blocks, language, videoCount, limitFn } = args;
  const depth = args.depth ?? 0;
  const joined = blocks.join("\n\n");

  if (VIDEOS_SUMMARY_NOTE.length + joined.length <= REDUCE_CHAR_BUDGET) {
    return VIDEOS_SUMMARY_NOTE + joined;
  }

  if (depth >= REDUCE_MAX_RECURSION) {
    logger.warn(
      `SOP hierarchical reduce hit recursion cap (${REDUCE_MAX_RECURSION}) at ${blocks.length} blocks (${joined.length} chars) — passing through without further reduction (no truncation).`,
    );
    return VIDEOS_SUMMARY_NOTE + joined;
  }

  const chunks = packBlocksIntoChunks(blocks, REDUCE_CHUNK_BUDGET);
  const partials = await Promise.all(
    chunks.map((chunk, i) =>
      limitFn(() =>
        reduceOneChunk({
          chunkText: VIDEOS_SUMMARY_NOTE + chunk.join("\n\n"),
          language,
          chunkLabel: `L${depth + 1} chunk ${i + 1}/${chunks.length}`,
        }),
      ),
    ),
  );

  const partialBlocks = partials.map(
    (p, i) => `### Partial pattern set ${i + 1} of ${partials.length}\n\n${p}`,
  );
  const partialsChars = partialBlocks.join("\n\n").length;
  logger.info(
    `Hierarchical SOP reduce: ${videoCount} videos → ${chunks.length} chunks → partials (${partialsChars} chars) → ${
      VIDEOS_SUMMARY_NOTE.length + partialsChars <= REDUCE_CHAR_BUDGET ? "final SOP" : "recurse"
    } (level ${depth + 1})`,
  );

  return buildReducedVideosData({
    blocks: partialBlocks,
    language,
    videoCount,
    limitFn,
    depth: depth + 1,
  });
}

async function parseCommentsSummaryJson(raw: string): Promise<CommentsSummary | null> {
  try {
    return (await parseLlmJson(raw)) as CommentsSummary;
  } catch {
    return null;
  }
}

function formatCommentsSummary(s: CommentsSummary): string {
  const lines: string[] = [];
  if (s.top_themes?.length) lines.push(`**Top themes:** ${s.top_themes.join(" · ")}`);
  if (s.viral_triggers?.length)
    lines.push(`**Viral triggers:** ${s.viral_triggers.join(" · ")}`);
  if (s.praise_examples?.length)
    lines.push(`**Praise examples:**\n${s.praise_examples.map((q) => `- "${q}"`).join("\n")}`);
  if (s.criticisms?.length) lines.push(`**Criticisms:** ${s.criticisms.join(" · ")}`);
  if (s.audience_questions?.length)
    lines.push(`**Audience wants more of:** ${s.audience_questions.join(" · ")}`);
  return lines.join("\n");
}

function summarizeAnalysis(v: typeof clerkVideos.$inferSelect): string {
  const fields: Array<[string, string | null]> = [
    ["Framework", v.framework],
    ["Opening hook", v.openingHook],
    ["Hooks throughout", v.hooksThroughout],
    ["Script structure", v.scriptStructure],
    ["Storytelling", v.storytellingFramework],
    ["Retention pattern", v.retentionPattern],
    ["Key takeaways", v.keyTakeaways],
  ];
  return fields
    .filter(([, val]) => val)
    .map(([k, val]) => `**${k}**: ${val}`)
    .join("\n\n");
}

// DeepSeek wraps JSON in markdown and leaves inner quotes unescaped in CJK values; jsonrepair recovers both.
async function parseAnalysis(rawText: string): Promise<ReturnType<typeof clerkAnalysisToDbRow> | null> {
  let parsed: unknown;
  try {
    parsed = await parseLlmJson(rawText);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const obj = parsed as Record<string, unknown>;
  // Fields sometimes arrive as {timestamp,text} objects — extract prose, don't serialize.
  const PROSE_TEXT_KEYS = ["text", "description", "value", "content", "detail", "point", "summary"];
  const PROSE_LABEL_KEYS = ["timestamp", "time", "type", "label", "name", "title"];
  const toProse = (x: unknown): string => {
    if (x == null) return "";
    if (typeof x === "string") return x;
    if (typeof x === "number" || typeof x === "boolean") return String(x);
    if (Array.isArray(x)) return x.map(toProse).filter(Boolean).join("\n");
    if (typeof x === "object") {
      const o = x as Record<string, unknown>;
      const tk = PROSE_TEXT_KEYS.find((k) => typeof o[k] === "string" && (o[k] as string).trim());
      if (tk) {
        const lk = PROSE_LABEL_KEYS.find((k) => typeof o[k] === "string" && (o[k] as string).trim());
        return `${lk ? `${(o[lk] as string).trim()} ` : ""}${(o[tk] as string).trim()}`;
      }
      const vals = Object.values(o).filter((v): v is string => typeof v === "string" && v.trim().length > 0);
      return vals.join(" — ");
    }
    return String(x);
  };
  const str = (k: string): string => toProse(obj[k]);

  const candidate = {
    thumbnail_description: str("thumbnail_description"),
    thumbnail_why_it_works: str("thumbnail_why_it_works"),
    opening_hook: str("opening_hook"),
    opening_hook_type: str("opening_hook_type"),
    hooks_throughout: str("hooks_throughout"),
    all_hook_types: str("all_hook_types"),
    text_hook: str("text_hook"),
    framework: str("framework"),
    opening_structure: str("opening_structure"),
    script_structure: str("script_structure"),
    storytelling_framework: str("storytelling_framework"),
    rehooks_used: str("rehooks_used"),
    retention_pattern: str("retention_pattern"),
    cta_placement: str("cta_placement"),
    key_takeaways: str("key_takeaways"),
  };

  const valid = clerkAnalysisSchema.safeParse(candidate);
  if (!valid.success) return null;
  return clerkAnalysisToDbRow(valid.data);
}

// 8 fits large-1x RAM and Groq Developer tier (300 RPM) absorbs the ASR fan-out;
// raise toward ~16 if the APIs stay stable.
const VIDEO_CONCURRENCY = 8;

export const analyzeChannel = task({
  id: "clerk-analyze-channel",
  queue: userRunsQueue,
  machine: { preset: "large-1x" },
  // 4h headroom for 20 long-form videos with ASR + SOPs (Trigger.dev Hobby).
  maxDuration: 14400,
  run: async (payload: Payload) => {
    const limit = payload.limit ?? 5;
    const language = payload.language ?? "en";

    return withMeteredRunDb({ runId: payload.runId, userId: payload.userId, feature: "clerk-analyze-channel" }, async (db) => {

    // videoTracks is keyed by id so concurrent videos don't overwrite each other's state.
    const appendLog = (msg: string) =>
      void metadata.append("log", { ts: Date.now(), msg });
    const tracks: Record<string, { title: string; phase: string; startedAt: number }> = {};
    const updateTrack = (id: string, patch: Partial<{ title: string; phase: string; startedAt: number }>) => {
      tracks[id] = { ...(tracks[id] ?? { title: id, phase: "queued", startedAt: Date.now() }), ...patch };
      void metadata.set("videoTracks", { ...tracks });
    };

      if (!payload.channelId === !payload.competitorAccountId) {
        throw new Error("Exactly one of channelId or competitorAccountId must be provided");
      }
      // `owner` decides which ownership columns get stamped and which dedup twin applies.
      let channel: { id: string; name: string; platform: "youtube" | "xhs" | "douyin"; platformUrl: string };
      let owner: RunOwner;
      if (payload.competitorAccountId) {
        const [comp] = await db
          .select()
          .from(competitorAccounts)
          .where(eq(competitorAccounts.id, payload.competitorAccountId))
          .limit(1);
        if (!comp) throw new Error(`competitor ${payload.competitorAccountId} not found`);
        channel = {
          id: comp.id,
          name: comp.name ?? comp.url,
          platform: comp.platform as "youtube" | "xhs" | "douyin",
          platformUrl: comp.url,
        };
        owner = { channelId: null, ownAccountId: null, competitorAccountId: comp.id };
      } else {
        const [ch] = await db
          .select()
          .from(channels)
          .where(eq(channels.id, payload.channelId!))
          .limit(1);
        if (!ch) throw new Error(`channel ${payload.channelId} not found`);
        channel = { id: ch.id, name: ch.name, platform: ch.platform, platformUrl: ch.platformUrl };
        owner = { channelId: ch.id, ownAccountId: ch.id, competitorAccountId: null };
      }
      const isOwn = owner.channelId !== null;
      const ownerVideoCond = isOwn
        ? eq(clerkVideos.channelId, channel.id)
        : eq(clerkVideos.competitorAccountId, channel.id);
      const videoConflict = isOwn
        ? { target: [clerkVideos.channelId, clerkVideos.platformVideoId] }
        : {
            target: [clerkVideos.competitorAccountId, clerkVideos.platformVideoId],
            targetWhere: sql`${clerkVideos.competitorAccountId} is not null`,
          };

      logger.info(`Analyzing ${isOwn ? "channel" : "competitor"}: ${channel.name} (${channel.platformUrl})`);
      appendLog(`开始分析 ${channel.name}`);
      // If the reaper already marked this run failed, abort — otherwise we deliver a run
      // the user was already refunded for.
      const [started] = await db
        .update(pipelineRuns)
        .set({ status: "running", startedAt: new Date() })
        .where(and(eq(pipelineRuns.id, payload.runId), ne(pipelineRuns.status, "failed")))
        .returning({ id: pipelineRuns.id });
      if (!started) throw new Error("run already settled (reaped) — aborting to avoid double-deliver");

      let proxyPool: ProxyPool | null = null;
      if (channel.platform === "youtube") {
        proxyPool = await loadProxyPool(db, { provider: "wealthproxies" });
        logger.info(
          `Loaded proxy pool: ${proxyPool.size} sessions (${proxyPool.aliveCount} alive)`,
        );
        appendLog(`代理池就绪：${proxyPool.size} 个 session 可用`);
        if (proxyPool.size === 0) {
          logger.warn(
            "Proxy pool empty — YouTube ASR will be skipped for caption-less videos.",
          );
          appendLog("⚠ 代理池为空，无字幕视频将跳过 ASR");
        }
      }

      let analyzed = 0;
      let failed = 0;
      let selectedCount = 0;
      let degradedToText = 0;

      // Throws on unparseable analysis so the caller's per-item catch records the failure.
      const analyzeVisionUpsert = async (
        item: ResolvedClerkItem,
        ctx: { stepBase: { current: number; total: number }; index: number; total: number },
      ) => {
        const { stepBase, index, total } = ctx;
        const label = `[${index + 1}/${total}] ${item.title}`;
        updateTrack(item.platformVideoId, { phase: "AI 分析" });
        await metadata.set("progress", {
          ...stepBase,
          phase: item.transcript ? "running analyzer" : "running analyzer (no text)",
          detail: item.transcript ? `${label} · AI 分析中` : `${label} · 仅基于标题分析`,
        });

        const prompt = buildVideoAnalysisPrompt({
          title: item.title,
          views: item.views,
          durationSec: item.durationSec,
          thumbnailUrl: item.thumbnailUrl,
          transcript: item.transcript,
          contentType: item.contentType,
          language,
        });

        // For image posts pass the whole gallery so Claude synthesizes the sequence.
        const visionPromise =
          item.visionUrls.length > 0
            ? (item.visionUrls.length > 1
                ? analyzeImageStack(item.visionUrls, language, logger)
                : analyzeThumbnail(item.visionUrls[0]!, language, logger)
              ).catch((err: Error) => {
                logger.warn(`Vision failed for ${item.platformVideoId}: ${err.message?.slice(0, 120)}`);
                return null;
              })
            : null;

        // Flash, not Pro: 4-7× faster and equally reliable (A/B verified); 16384 leaves
        // headroom so a valid response never truncates.
        let dbAnalysisRaw: Awaited<ReturnType<typeof parseAnalysis>> = null;
        let lastHead = "";
        for (let attempt = 0; attempt < 2 && !dbAnalysisRaw; attempt++) {
          const result = await generateText({
            model: llm("flash"),
            prompt,
            maxOutputTokens: 16384,
            temperature: 0.3,
            maxRetries: 2,
          });
          dbAnalysisRaw = await parseAnalysis(result.text);
          if (dbAnalysisRaw) {
            const nonEmpty = Object.values(dbAnalysisRaw).filter(
              (v) => typeof v === "string" && v.trim().length > 0,
            ).length;
            if (nonEmpty < 3) {
              logger.warn(`${item.platformVideoId}: analysis parsed but near-empty (${nonEmpty} fields), retrying`);
              dbAnalysisRaw = null;
            }
          }
          if (!dbAnalysisRaw) {
            lastHead = result.text.slice(0, 200);
            logger.warn(`${item.platformVideoId}: analysis parse failed (attempt ${attempt + 1})`);
          }
        }
        if (!dbAnalysisRaw) {
          throw new Error(`Could not parse analysis JSON. Raw response head: ${lastHead}`);
        }
        const dbAnalysis = dbAnalysisRaw;
        let coverDiagnosis: string | null = null;
        let coverTitleSuggestions: string[] | null = null;
        let coverVisionAt: Date | null = null;

        if (visionPromise) {
          await metadata.set("progress", {
            ...stepBase,
            phase: "analyzing thumbnail",
            detail:
              item.visionUrls.length > 1
                ? `${label} · 视觉识别 ${item.visionUrls.length} 张图`
                : `${label} · 视觉识别封面图`,
          });
          const visual = await visionPromise;
          if (visual) {
            // A real read is authoritative for the whole field: keeping the text model's guess
            // for an empty part leaves a guess behind the vision gate.
            dbAnalysis.thumbnailDescription = visual.description || "";
            dbAnalysis.thumbnailWhyItWorks = visual.whyItWorks || "";
            coverVisionAt = new Date();
            coverDiagnosis = visual.diagnosis;
            coverTitleSuggestions = visual.titleSuggestions.length > 0 ? visual.titleSuggestions : null;
          } else {
            logger.warn(`Vision returned no read for ${item.platformVideoId} — cover excluded from SOP`);
          }
        }

        const upsert = {
          ...owner,
          platformVideoId: item.platformVideoId,
          title: item.title,
          url: item.url,
          views: item.views,
          durationSec: item.durationSec,
          thumbnailUrl: item.thumbnailUrl,
          sourceChannelName: item.sourceChannelName,
          sourceChannelId: item.sourceChannelId,
          transcript: safeText(item.transcript),
          transcriptSource: item.transcriptSource,
          contentType: item.contentType,
          coverDiagnosis,
          coverTitleSuggestions,
          ...dbAnalysis,
          analyzedAt: new Date(),
          runId: payload.runId,
        };

        await metadata.set("progress", {
          ...stepBase,
          phase: "writing analysis",
          detail: `[${index + 1}/${total}] 写入数据库`,
        });
        await db
          .insert(clerkVideos)
          .values(upsert)
          .onConflictDoUpdate({
            ...videoConflict,
            // Re-analysis invalidates the cached SOP map summary, same as the YouTube path.
            set: { ...upsert, sopMapSummary: null },
          });
      };

      if (channel.platform === "xhs") {
        const xhsSource = payload.source ?? "newest";
        let xhsNotes: XhsNote[] = [];

        if (xhsSource === "urls") {
          await metadata.set("progress", {
            current: 0,
            total: 0,
            phase: "resolving notes",
            detail: `解析 ${payload.videoIds?.length ?? 0} 个小红书链接`,
          });
          // Mobile share pastes are xhslink.com short links; expand first, keeping the
          // pasted xsec_token as a fallback for the note URL.
          const ids: Array<{ noteId: string; xsecToken: string | null }> = [];
          for (const line of payload.videoIds ?? []) {
            const expanded = await expandXhsShortLink(line);
            const noteId = extractXhsNoteId(expanded);
            if (noteId) ids.push({ noteId, xsecToken: extractXsecToken(expanded) });
          }
          if (ids.length === 0) {
            throw new Error("没有可用的小红书笔记链接 — 请确认 URL 格式正确");
          }
          // TikHub rate-limited to 1 req/sec per route; serialize fetches.
          for (let n = 0; n < ids.length; n++) {
            const { noteId, xsecToken } = ids[n]!;
            try {
              const detail = await getXhsNoteDetail(noteId, xsecToken);
              if (detail) xhsNotes.push(detail);
              else logger.warn(`XHS note ${noteId} not found`);
            } catch (err) {
              logger.warn(
                `XHS note ${noteId} fetch failed: ${(err as Error).message?.slice(0, 120)}`,
              );
            }
            if (n < ids.length - 1) await sleep(1100);
          }
        } else {
          await metadata.set("progress", {
            current: 0,
            total: 0,
            phase: "resolving channel",
            detail: `正在解析 ${channel.platformUrl}`,
          });
          await metadata.set("progress", {
            current: 0,
            total: 0,
            phase: "fetching notes",
            detail:
              xhsSource === "popular"
                ? "抓取频道笔记后按互动分排序"
                : "抓取频道最新笔记列表",
          });
          const fetchLimit = xhsSource === "popular" ? Math.min(20, limit * 4) : limit;
          const all = await getXhsUserNotes(channel.platformUrl, fetchLimit);
          if (xhsSource === "popular") {
            all.sort((a, b) => b.engagementScore - a.engagementScore);
          }
          xhsNotes = all.slice(0, limit);
          logger.info(
            `XHS sourced ${xhsNotes.length} notes via "${xhsSource}" (available=${all.length})`,
          );
          appendLog(`抓取到 ${all.length} 篇笔记，按「${xhsSource}」选取 ${xhsNotes.length} 篇`);
        }

        if (payload.mode === "incremental") {
          const existingRows = await db
            .select({ platformVideoId: clerkVideos.platformVideoId })
            .from(clerkVideos)
            .where(ownerVideoCond);
          const existingIds = new Set(existingRows.map((r) => r.platformVideoId));
          const before = xhsNotes.length;
          xhsNotes = xhsNotes.filter((n) => !existingIds.has(n.noteId));
          logger.info(
            `XHS incremental: skipped ${before - xhsNotes.length}/${before} already-analyzed`,
          );
        }

        selectedCount = xhsNotes.length;
        logger.info(
          `Selected ${xhsNotes.length} XHS notes (limit=${limit}, source=${xhsSource}, mode=${payload.mode ?? "overwrite"})`,
        );

        if (xhsNotes.length === 0 && payload.mode !== "incremental") {
          throw new Error("没有 XHS 笔记可分析");
        }

        await db
          .update(pipelineRuns)
          .set({ total: xhsNotes.length, progress: 0 })
          .where(eq(pipelineRuns.id, payload.runId));

        // Duration-weighted progress: video notes (ASR) cost far more than image posts.
        const noteDurOf = (n: (typeof xhsNotes)[number]) =>
          n.type === "video" && (n.durationSec ?? 0) > 0 ? Math.max(n.durationSec ?? 0, 30) : 45;
        const totalNoteDur = xhsNotes.reduce((s, n) => s + noteDurOf(n), 0);
        let doneNoteDur = 0;
        const xhsLoopStart = Date.now();

        let completedNotes = 0;
        const processOneNote = async (note: (typeof xhsNotes)[number], i: number) => {
          // Parallel notes finish out of order, so the per-note index would make the bar jump.
          const stepBase = { current: completedNotes, total: xhsNotes.length };
          const titleAndDesc = [note.title, note.desc]
            .filter((s) => s.trim().length > 0)
            .join("\n\n");

          updateTrack(note.noteId, {
            title: note.title,
            phase: note.type === "video" ? "transcribing" : "AI 分析",
            startedAt: Date.now(),
          });
          await metadata.set("progress", {
            ...stepBase,
            phase: "fetching note",
            detail: `[${i + 1}/${xhsNotes.length}] ${note.title}`,
          });

          try {
            let transcript: string | null = null;
            let transcriptSource: string;
            let contentType: "xhs_video" | "xhs_image";

            if (note.type === "video") {
              contentType = "xhs_video";
              if (note.videoStreams.length === 0) {
                transcript = titleAndDesc || null;
                transcriptSource = "xhs_text";
                logger.warn(`XHS video note ${note.noteId}: no streams, text-only`);
              } else {
                await metadata.set("progress", {
                  ...stepBase,
                  phase: "transcribing audio",
                  detail: `[${i + 1}/${xhsNotes.length}] ${note.title} · 音频转写中`,
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
                    onPhase: (phase, ph) => {
                      const detailMap: Record<typeof phase, string> = {
                        selecting: "选择视频流",
                        downloading: "下载视频中",
                        transcribing: ph?.bytes
                          ? `音频转写中（${(ph.bytes / 1024 / 1024).toFixed(1)} MB）`
                          : "音频转写中",
                      };
                      void metadata.set("progress", {
                        ...stepBase,
                        phase: "transcribing audio",
                        detail: `[${i + 1}/${xhsNotes.length}] ${note.title} · ${detailMap[phase]}`,
                      });
                    },
                  },
                );
                if (asr) {
                  transcript = (titleAndDesc + "\n\n[Audio Transcript]\n" + asr.text).trim();
                  transcriptSource = "xhs_asr";
                } else {
                  transcript = titleAndDesc || null;
                  transcriptSource = "xhs_text";
                  logger.warn(
                    `XHS video ${note.noteId}: ASR returned null, falling back to text`,
                  );
                }
              }
            } else {
              contentType = "xhs_image";
              transcript = titleAndDesc || null;
              transcriptSource = "xhs_text";
            }

            if (transcriptSource === "xhs_asr") appendLog(`音频转写完成：${note.title.slice(0, 50)}`);
            else if (transcriptSource === "xhs_text") appendLog(`文本提取：${note.title.slice(0, 50)}`);

            await analyzeVisionUpsert(
              {
                platformVideoId: note.noteId,
                title: note.title,
                views: note.engagementScore,
                durationSec: note.durationSec,
                url: note.noteUrl,
                thumbnailUrl: note.thumbnailUrl,
                contentType,
                sourceChannelName: note.channelName,
                sourceChannelId: note.channelId,
                transcript,
                transcriptSource,
                visionUrls:
                  note.type === "image" && note.images.length > 0
                    ? note.images.map((img) => img.originalUrl || img.url).filter(Boolean)
                    : note.thumbnailUrl
                      ? [note.thumbnailUrl]
                      : [],
              },
              { stepBase, index: i, total: xhsNotes.length },
            );

            analyzed++;
            updateTrack(note.noteId, { phase: "done" });
            appendLog(`✓ ${note.title.slice(0, 50)}`);
            await db
              .update(pipelineRuns)
              .set({ progress: analyzed })
              .where(eq(pipelineRuns.id, payload.runId));
          } catch (err) {
            failed++;
            const msg = (err as Error).message ?? String(err);
            const stack = (err as Error).stack?.split("\n").slice(0, 5).join("\n") ?? "";
            console.error(
              `[analyze-channel] Failed XHS note ${note.noteId} (${note.title}):`,
              msg,
            );
            console.error(stack);
            logger.error(`Failed XHS note ${note.noteId}`, {
              title: note.title,
              message: msg.slice(0, 500),
              stack,
            });
            updateTrack(note.noteId, { phase: "failed" });
            appendLog(`✗ ${note.title.slice(0, 50)} — ${msg.slice(0, 60)}`);
          } finally {
            completedNotes++;
            doneNoteDur += noteDurOf(note);
            const fracDone =
              totalNoteDur > 0 ? doneNoteDur / totalNoteDur : completedNotes / xhsNotes.length;
            const elapsedSec = (Date.now() - xhsLoopStart) / 1000;
            await metadata.set("progress", {
              current: completedNotes,
              total: xhsNotes.length,
              phase: "processing notes",
              detail: `已完成 ${completedNotes}/${xhsNotes.length}`,
              fracDone: Math.round(fracDone * 1000) / 1000,
              ...((completedNotes >= VIDEO_CONCURRENCY || fracDone >= 0.25) &&
              completedNotes < xhsNotes.length &&
              fracDone > 0.05
                ? {
                    estSecondsRemaining: Math.max(
                      0,
                      Math.round(elapsedSec / fracDone - elapsedSec),
                    ),
                  }
                : {}),
            });
          }
        };

        const concurrency = pLimit(VIDEO_CONCURRENCY);
        await Promise.all(xhsNotes.map((note, i) => concurrency(() => processOneNote(note, i))));
      } else if (channel.platform === "douyin") {
        const dySource = payload.source ?? "newest";
        // urls-mode items keep their fresh `play` so processing doesn't refetch the detail.
        let dyVideos: Array<DouyinVideo & { play?: DouyinPlaySource }> = [];

        if (dySource === "urls") {
          await metadata.set("progress", {
            current: 0,
            total: 0,
            phase: "resolving videos",
            detail: `解析 ${payload.videoIds?.length ?? 0} 个抖音链接`,
          });
          const ids: string[] = [];
          for (const line of payload.videoIds ?? []) {
            const expanded = await expandDouyinShortLink(line);
            const awemeId = extractDouyinAwemeId(expanded);
            if (awemeId) ids.push(awemeId);
          }
          if (ids.length === 0) {
            throw new Error("没有可用的抖音链接 — 请确认 URL 格式正确");
          }
          for (let n = 0; n < ids.length; n++) {
            try {
              const detail = await getDouyinVideoDetail(ids[n]!);
              if (detail) dyVideos.push(detail);
              else logger.warn(`Douyin video ${ids[n]} not found`);
            } catch (err) {
              logger.warn(
                `Douyin video ${ids[n]} fetch failed: ${(err as Error).message?.slice(0, 120)}`,
              );
            }
            if (n < ids.length - 1) await sleep(150);
          }
        } else {
          await metadata.set("progress", {
            current: 0,
            total: 0,
            phase: "fetching videos",
            detail:
              dySource === "popular" ? "抓取账号作品后按互动分排序" : "抓取账号最新作品列表",
          });
          const secUid =
            extractDouyinSecUserId(channel.platformUrl) ??
            (await resolveDouyinUser(channel.platformUrl)).secUserId;
          const fetchLimit = Math.min(60, limit * 4);
          let all = await getDouyinUserVideos(secUid, fetchLimit);
          if (payload.recencyMonths) {
            const cutoff = Date.now() / 1000 - payload.recencyMonths * 30 * 86400;
            all = all.filter((v) => v.createTime >= cutoff);
          }
          if (dySource === "popular") {
            all.sort((a, b) => b.engagementScore - a.engagementScore);
          } else {
            // List order is pinned-first; "newest" must not let an old pinned video occupy a slot.
            all.sort((a, b) => b.createTime - a.createTime);
          }
          dyVideos = all.slice(0, limit);
          logger.info(
            `Douyin sourced ${dyVideos.length} videos via "${dySource}" (available=${all.length})`,
          );
          appendLog(`抓取到 ${all.length} 条作品，按「${dySource}」选取 ${dyVideos.length} 条`);
        }

        if (payload.mode === "incremental") {
          const existingRows = await db
            .select({ platformVideoId: clerkVideos.platformVideoId })
            .from(clerkVideos)
            .where(ownerVideoCond);
          const existingIds = new Set(existingRows.map((r) => r.platformVideoId));
          const before = dyVideos.length;
          dyVideos = dyVideos.filter((v) => !existingIds.has(v.awemeId));
          logger.info(
            `Douyin incremental: skipped ${before - dyVideos.length}/${before} already-analyzed`,
          );
        }

        selectedCount = dyVideos.length;
        logger.info(
          `Selected ${dyVideos.length} Douyin videos (limit=${limit}, source=${dySource}, mode=${payload.mode ?? "overwrite"})`,
        );

        if (dyVideos.length === 0 && payload.mode !== "incremental") {
          throw new Error("没有抖音作品可分析");
        }

        await db
          .update(pipelineRuns)
          .set({ total: dyVideos.length, progress: 0 })
          .where(eq(pipelineRuns.id, payload.runId));

        const itemDurOf = (v: DouyinVideo) =>
          v.contentType === "douyin_video" && (v.durationSec ?? 0) > 0
            ? Math.max(v.durationSec ?? 0, 30)
            : 45;
        const totalItemDur = dyVideos.reduce((s, v) => s + itemDurOf(v), 0);
        let doneItemDur = 0;
        const dyLoopStart = Date.now();

        let completedItems = 0;
        const processOneDouyin = async (
          item: DouyinVideo & { play?: DouyinPlaySource },
          i: number,
        ) => {
          const stepBase = { current: completedItems, total: dyVideos.length };
          updateTrack(item.awemeId, {
            title: item.title,
            phase: item.contentType === "douyin_video" ? "transcribing" : "AI 分析",
            startedAt: Date.now(),
          });
          await metadata.set("progress", {
            ...stepBase,
            phase: "fetching video",
            detail: `[${i + 1}/${dyVideos.length}] ${item.title}`,
          });

          try {
            // Play URLs expire in 60-90 min: reuse a carried `play` only well inside that TTL,
            // otherwise refetch the detail (which also refreshes the signed cover/image URLs).
            const carried =
              item.play && (item.play.cdnUrlExpiresAt ?? 0) * 1000 > Date.now() + 10 * 60_000
                ? ({ ...item, play: item.play } as DouyinVideo & { play: DouyinPlaySource })
                : null;
            let detail: (DouyinVideo & { play: DouyinPlaySource }) | null = carried;
            if (!detail) {
              try {
                detail = await getDouyinVideoDetail(item.awemeId);
              } catch (err) {
                logger.warn(
                  `Douyin detail refresh failed for ${item.awemeId}: ${(err as Error).message?.slice(0, 120)}`,
                );
              }
              // No detail means no play streams: the video degrades to caption-only analysis
              // while still billing its full duration.
              if (!detail && item.contentType === "douyin_video") {
                degradedToText++;
                appendLog(`「${item.title.slice(0, 24)}」详情获取失败，仅按文案分析（无转写）`);
              }
            }
            const video = detail ?? item;
            const textBase = video.desc.trim() || video.title;

            let transcript: string | null = null;
            let transcriptSource: string;
            const contentType = video.contentType;

            if (contentType === "douyin_video" && detail) {
              const streams = buildDouyinAsrStreams(detail.play);
              if (streams.length === 0) {
                transcript = textBase || null;
                transcriptSource = "douyin_text";
                logger.warn(`Douyin video ${video.awemeId}: no streams, text-only`);
              } else {
                await metadata.set("progress", {
                  ...stepBase,
                  phase: "transcribing audio",
                  detail: `[${i + 1}/${dyVideos.length}] ${video.title} · 音频转写中`,
                });
                const asr = await transcribeFromStreams(streams, {
                  logger,
                  durationSec: video.durationSec ?? undefined,
                  tag: `Douyin ${video.awemeId}`,
                  preserveOrder: true,
                  onPhase: (phase, ph) => {
                    const detailMap: Record<typeof phase, string> = {
                      selecting: "选择音视频流",
                      downloading: "下载媒体中",
                      transcribing: ph?.bytes
                        ? `音频转写中（${(ph.bytes / 1024 / 1024).toFixed(1)} MB）`
                        : "音频转写中",
                    };
                    void metadata.set("progress", {
                      ...stepBase,
                      phase: "transcribing audio",
                      detail: `[${i + 1}/${dyVideos.length}] ${video.title} · ${detailMap[phase]}`,
                    });
                  },
                });
                if (asr) {
                  transcript = (textBase + "\n\n[Audio Transcript]\n" + asr.text).trim();
                  transcriptSource = "douyin_asr";
                } else {
                  transcript = textBase || null;
                  transcriptSource = "douyin_text";
                  logger.warn(
                    `Douyin video ${video.awemeId}: ASR returned null, falling back to text`,
                  );
                }
              }
            } else {
              transcript = textBase || null;
              transcriptSource = "douyin_text";
            }

            if (transcriptSource === "douyin_asr") appendLog(`音频转写完成：${video.title.slice(0, 50)}`);
            else appendLog(`文本提取：${video.title.slice(0, 50)}`);

            await analyzeVisionUpsert(
              {
                platformVideoId: video.awemeId,
                title: video.title,
                views: video.engagementScore,
                durationSec: video.durationSec,
                url: video.videoUrl,
                thumbnailUrl: video.coverUrl,
                contentType,
                sourceChannelName: video.authorNickname ?? channel.name,
                sourceChannelId: video.authorSecUserId,
                transcript,
                transcriptSource,
                visionUrls:
                  contentType === "douyin_image" && video.images.length > 0
                    ? video.images.slice(0, 9).map((img) => img.url)
                    : video.coverUrl
                      ? [video.coverUrl]
                      : [],
              },
              { stepBase, index: i, total: dyVideos.length },
            );

            analyzed++;
            updateTrack(item.awemeId, { phase: "done" });
            appendLog(`✓ ${video.title.slice(0, 50)}`);
            await db
              .update(pipelineRuns)
              .set({ progress: analyzed })
              .where(eq(pipelineRuns.id, payload.runId));
          } catch (err) {
            failed++;
            const msg = (err as Error).message ?? String(err);
            const stack = (err as Error).stack?.split("\n").slice(0, 5).join("\n") ?? "";
            console.error(`[analyze-channel] Failed Douyin video ${item.awemeId} (${item.title}):`, msg);
            console.error(stack);
            logger.error(`Failed Douyin video ${item.awemeId}`, {
              title: item.title,
              message: msg.slice(0, 500),
              stack,
            });
            updateTrack(item.awemeId, { phase: "failed" });
            appendLog(`✗ ${item.title.slice(0, 50)} — ${msg.slice(0, 60)}`);
          } finally {
            completedItems++;
            doneItemDur += itemDurOf(item);
            const fracDone =
              totalItemDur > 0 ? doneItemDur / totalItemDur : completedItems / dyVideos.length;
            const elapsedSec = (Date.now() - dyLoopStart) / 1000;
            await metadata.set("progress", {
              current: completedItems,
              total: dyVideos.length,
              phase: "processing videos",
              detail: `已完成 ${completedItems}/${dyVideos.length}`,
              fracDone: Math.round(fracDone * 1000) / 1000,
              ...((completedItems >= VIDEO_CONCURRENCY || fracDone >= 0.25) &&
              completedItems < dyVideos.length &&
              fracDone > 0.05
                ? {
                    estSecondsRemaining: Math.max(0, Math.round(elapsedSec / fracDone - elapsedSec)),
                  }
                : {}),
            });
          }
        };

        const concurrency = pLimit(VIDEO_CONCURRENCY);
        await Promise.all(dyVideos.map((v, i) => concurrency(() => processOneDouyin(v, i))));
      } else {
        const source = payload.source ?? "newest";
        let selected: SelectedVideoRef[] = [];
        let candidateMeta = new Map<string, YoutubeVideoMeta>();

      if (source === "urls") {
        await metadata.set("progress", {
          current: 0,
          total: 0,
          phase: "resolving videos",
          detail: `解析 ${payload.videoIds?.length ?? 0} 个视频链接`,
        });
        const ids = (payload.videoIds ?? [])
          .map((s) => extractYoutubeVideoIdLocal(s))
          .filter((id): id is string => id !== null);
        if (ids.length === 0) {
          throw new Error("没有可用的 YouTube 视频链接 — 请确认 URL 格式正确");
        }
        selected = ids.map((id) => ({
          video_id: id,
          title: id,
          url: `https://www.youtube.com/watch?v=${id}`,
        }));
      } else {
        await metadata.set("progress", {
          current: 0,
          total: 0,
          phase: "resolving channel",
          detail: `正在解析 ${channel.platformUrl}`,
        });

        if (!proxyPool) throw new Error("YouTube path requires proxyPool — not loaded");

        await metadata.set("progress", {
          current: 0,
          total: 0,
          phase: "fetching videos",
          detail:
            source === "popular"
              ? "抓取频道最近视频后按播放量排序"
              : "抓取频道最新视频列表",
        });
        // Over-fetch so sort/recency filter has candidates; yt-dlp lazy-flat caps cost.
        const fetchN = source === "popular" || payload.recencyMonths ? 100 : Math.max(limit * 3, limit);
        let videos: YtdlpChannelVideo[] | null = null;
        videos = await withProxyRetry(
          proxyPool,
          (session) => listChannelVideos(channel.platformUrl, fetchN, session.url, logger),
          {
            onRetry: (attempt, kind) => {
              logger.warn(`Channel list ${channel.platformUrl} attempt ${attempt} (${kind}) — retrying on fresh session`);
              appendLog(`⚠ 频道列表第 ${attempt} 次被拦截（${kind}），换 IP 重试`);
            },
          },
        ).catch((err: Error) => {
          throw new Error(
            `Could not list videos for "${channel.platformUrl}". ` +
              `Make sure the URL points to a real channel page (e.g. https://www.youtube.com/@kai-w). ` +
              `Underlying error: ${err.message}`,
          );
        });

        // yt-dlp flat mode returns null view_count + upload_date for YouTube. Enrich via
        // YT Data API (1 quota unit per 50 videos) so popular sort + recency filter work.
        if (source === "popular" || payload.recencyMonths) {
          candidateMeta = await fetchVideoMetadataBatch(videos.map((v) => v.video_id));
        }

        let candidates = videos;
        if (payload.recencyMonths) {
          const cutoff = Date.now() - payload.recencyMonths * 30 * 24 * 3600 * 1000;
          candidates = candidates.filter((v) => {
            const meta = candidateMeta.get(v.video_id);
            if (!meta?.publishedAt) return false;
            return new Date(meta.publishedAt).getTime() >= cutoff;
          });
          logger.info(
            `Recency filter (${payload.recencyMonths}mo): ${candidates.length}/${videos.length} kept`,
          );
          appendLog(`近 ${payload.recencyMonths} 月筛选：保留 ${candidates.length}/${videos.length}`);
        }
        if (source === "popular") {
          candidates = [...candidates].sort((a, b) => {
            const av = candidateMeta.get(a.video_id)?.viewCount ?? 0;
            const bv = candidateMeta.get(b.video_id)?.viewCount ?? 0;
            return bv - av;
          });
        }
        selected = candidates.slice(0, limit).map((v) => ({
          video_id: v.video_id,
          title: v.title,
          url: v.url,
          view_count: candidateMeta.get(v.video_id)?.viewCount ?? v.views ?? undefined,
          thumbnail: v.thumbnail_url,
        }));
        logger.info(
          `Sourced ${selected.length} videos via "${source}" (available=${videos.length}, after-filter=${candidates.length})`,
        );
        appendLog(`已选取 ${selected.length} 个视频（${source} 模式）`);
      }

      if (payload.mode === "incremental") {
        const existingRows = await db
          .select({ platformVideoId: clerkVideos.platformVideoId })
          .from(clerkVideos)
          .where(ownerVideoCond);
        const existingIds = new Set(existingRows.map((r) => r.platformVideoId));
        const before = selected.length;
        selected = selected.filter((v) => !existingIds.has(v.video_id));
        logger.info(
          `Incremental mode: skipped ${before - selected.length}/${before} already-analyzed videos`,
        );
      }

      logger.info(
        `Selected ${selected.length} videos (limit=${limit}, source=${source}, mode=${payload.mode ?? "overwrite"})`,
      );

      if (selected.length === 0) {
        if (payload.mode === "incremental") {
          logger.info("No new videos to analyze; jumping straight to SOP regeneration");
        } else {
          throw new Error("No videos found on this channel");
        }
      }

      await db
        .update(pipelineRuns)
        .set({ total: selected.length, progress: 0 })
        .where(eq(pipelineRuns.id, payload.runId));

      const selectedIds = selected.map((v) => v.video_id);
      const needsFetch = selectedIds.some((id) => !candidateMeta.has(id));
      const ytMetaMap = needsFetch
        ? await fetchVideoMetadataBatch(selectedIds)
        : candidateMeta;
      logger.info(
        `YouTube Data API metadata: ${ytMetaMap.size}/${selected.length} (fetch=${needsFetch})`,
      );

      const totalVideos = selected.length;
      let completedCount = 0;
      // Duration-weighted: a 30s short and a 60min ASR video share one parallel wave, so flat
      // 1/N is dishonest; the ETA stays hidden until a full wave or 25% has completed.
      const knownDurs = selected
        .map((v) => ytMetaMap.get(v.video_id)?.durationSec ?? 0)
        .filter((d) => d > 0)
        .sort((a, b) => a - b);
      const medianDur = knownDurs.length > 0 ? knownDurs[Math.floor(knownDurs.length / 2)]! : 300;
      const durOf = (id: string) => {
        const d = ytMetaMap.get(id)?.durationSec ?? 0;
        return d > 0 ? d : medianDur;
      };
      const totalDurSec = selected.reduce((s, v) => s + durOf(v.video_id), 0);
      let doneDurSec = 0;
      const loopStart = Date.now();

      const processOneVideo = async (ref: typeof selected[number]): Promise<void> => {
        const videoId = ref.video_id;
        updateTrack(videoId, { title: ref.title, phase: "fetching metadata", startedAt: Date.now() });
        try {
          if (!proxyPool) throw new Error("YouTube path requires proxyPool — not loaded");
          const info: YtdlpVideoMetadata | null = await withProxyRetry(
            proxyPool,
            (session) => getVideoMetadataYtdlp(videoId, session.url),
            {
              attempts: 3,
              okBytes: 10_000,
              onRetry: (attempt, kind) =>
                logger.warn(`yt-dlp metadata ${videoId} attempt ${attempt} (${kind}) — retrying on fresh session`),
            },
          ).catch((err: Error) => {
            logger.warn(
              `yt-dlp metadata failed for ${videoId}: ${err.message?.slice(0, 120)} — falling back to YT Data API only`,
            );
            appendLog(`⚠ ${videoId} 元数据获取失败，改用 YT Data API`);
            return null;
          });
          updateTrack(videoId, { phase: "transcribing" });
          const yt = ytMetaMap.get(videoId) ?? null;
          const meta = resolveVideoMeta({ yt, info, ref, videoId });

          let finalTranscript: {
            text: string;
            languageCode?: string;
            words: Array<{ w: string; t: number }>;
          } | null = null;
          let transcriptSource: "caption" | "asr" | null = null;
          const asr = await transcribeYoutubeVideo(videoId, proxyPool, {
            logger,
            durationSec: meta.durationSec ?? undefined,
            tag: `ASR ${videoId}`,
            qwenFirst: likelyChineseText(meta.title),
          });
          if (asr) {
            // Strip sponsor/selfpromo segments so the LLM doesn't analyze ad copy as content.
            const sponsorChapters = info?.sponsor_chapters ?? [];
            const cleanWords = stripAdSegments(asr.words, sponsorChapters);
            finalTranscript = {
              text: asr.text,
              languageCode: asr.detectedLanguage,
              words: cleanWords,
            };
            transcriptSource = asr.provider === "youtube_auto" ? "caption" : "asr";
            const stripped = asr.words.length - cleanWords.length;
            logger.info(
              `Transcript for ${videoId}: ${asr.text.length} chars via ${asr.provider}, ${asr.words.length} words (${stripped} stripped as sponsor/selfpromo), lang=${asr.detectedLanguage ?? "?"}`,
            );
          }

          // Render transcript with [mm:ss] markers so the LLM can cite exact moments.
          const transcriptForPrompt = finalTranscript
            ? renderTranscriptWithTimestamps(finalTranscript.text, finalTranscript.words)
            : null;

          if (transcriptSource === "caption") appendLog(`字幕命中：${ref.title.slice(0, 60)}`);
          else if (transcriptSource === "asr") appendLog(`ASR 转写完成：${ref.title.slice(0, 60)}`);
          else appendLog(`⚠ ${videoId} 无字幕也无音频`);
          updateTrack(videoId, { phase: "AI 分析" });

          const prompt = buildVideoAnalysisPrompt({
            title: meta.title,
            views: meta.views,
            durationSec: meta.durationSec,
            thumbnailUrl: meta.thumbnailUrl,
            transcript: transcriptForPrompt,
            chapters: info?.chapters,
            sponsorChapters: info?.sponsor_chapters,
            contentType: "video",
            language,
          });

          // 16K cap (vs 8K) prevents truncation on news-heavy videos with long JSON output.
          const [result, visual] = await Promise.all([
            generateText({
              model: llm("pro"),
              prompt,
              maxOutputTokens: 16000,
              temperature: 0.3,
              maxRetries: 2,
            }),
            meta.thumbnailUrl
              ? analyzeThumbnail(meta.thumbnailUrl, language, logger)
              : Promise.resolve(null),
          ]);

          let dbAnalysisRaw = await parseAnalysis(result.text);
          if (!dbAnalysisRaw) {
            const finish = result.finishReason ?? "unknown";
            logger.warn(
              `Parse failed for ${videoId} (finish=${finish}, len=${result.text.length}). ` +
                `Head: ${result.text.slice(0, 300)} | Tail: ${result.text.slice(-300)}`,
            );
            // Retry on Flash: Pro's usual failure is empty/length-truncated reasoning output,
            // and Flash spends no budget on hidden reasoning tokens.
            const retry = await generateText({
              model: llm("flash"),
              prompt:
                prompt +
                "\n\nIMPORTANT: Output ONLY the JSON object. Keep each string field under 400 characters. No markdown fences. No preamble.",
              maxOutputTokens: 16000,
              temperature: 0.2,
              maxRetries: 1,
            });
            dbAnalysisRaw = await parseAnalysis(retry.text);
            if (!dbAnalysisRaw) {
              throw new Error(
                `Parse failed twice for ${videoId} (finish=${retry.finishReason ?? "unknown"}, len=${retry.text.length}). ` +
                  `Head: ${retry.text.slice(0, 300)}`,
              );
            }
            logger.info(`Retry succeeded for ${videoId}`);
          }
          const dbAnalysis = Object.fromEntries(
            Object.entries(dbAnalysisRaw).map(([k, v]) => [
              k,
              typeof v === "string" ? v.replace(/\u0000/g, "") : v,
            ]),
          ) as typeof dbAnalysisRaw;

          // DeepSeek is text-only; Claude vision overrides its inferred thumbnail fields.
          let coverDiagnosis: string | null = null;
          let coverTitleSuggestions: string[] | null = null;
          let coverVisionAt: Date | null = null;
          if (visual) {
            // A real read is authoritative for the whole field: keeping the text model's guess
            // for an empty part leaves a guess behind the vision gate.
            dbAnalysis.thumbnailDescription = visual.description || "";
            dbAnalysis.thumbnailWhyItWorks = visual.whyItWorks || "";
            coverVisionAt = new Date();
            coverDiagnosis = visual.diagnosis;
            coverTitleSuggestions =
              visual.titleSuggestions.length > 0 ? visual.titleSuggestions : null;
            logger.info(
              `Vision applied for ${videoId} (diagnosis=${coverDiagnosis ? "yes" : "none"}, ${visual.titleSuggestions.length} title suggestions)`,
            );
          } else if (meta.thumbnailUrl) {
            logger.warn(`Vision returned null for ${videoId}, keeping DeepSeek-inferred fields`);
          }

          const upsert = {
            ...owner,
            platformVideoId: videoId,
            title: meta.title,
            url: meta.url,
            views: meta.views,
            durationSec: meta.durationSec,
            thumbnailUrl: meta.thumbnailUrl,
            sourceChannelName: meta.sourceChannelName,
            sourceChannelId: meta.sourceChannelId,
            // Persist timestamp-rendered transcript so the SOP stage can cite [m:ss].
            transcript: safeText(transcriptForPrompt) ?? safeText(finalTranscript?.text),
            transcriptSource,
            coverDiagnosis,
            coverTitleSuggestions,
            coverVisionAt,
            chapters: info?.chapters ?? null,
            sponsorChapters: info?.sponsor_chapters ?? null,
            ...dbAnalysis,
            analyzedAt: new Date(),
            runId: payload.runId,
          };

          await db
            .insert(clerkVideos)
            .values(upsert)
            .onConflictDoUpdate({
              ...videoConflict,
              // Without this the reduce step keeps feeding SOPs from the OLD analysis after a re-run.
              set: { ...upsert, sopMapSummary: null },
            });

          analyzed++;
          updateTrack(videoId, { phase: "done" });
          appendLog(`✓ ${ref.title.slice(0, 60)}`);
        } catch (err) {
          failed++;
          const msg = (err as Error).message ?? String(err);
          const stack = (err as Error).stack?.split("\n").slice(0, 5).join("\n") ?? "";
          console.error(`[analyze-channel] Failed video ${videoId} (${ref.title}):`, msg);
          console.error(stack);
          logger.error(`Failed video ${videoId}`, {
            title: ref.title,
            message: msg.slice(0, 500),
            stack,
          });
          updateTrack(videoId, { phase: "failed" });
          appendLog(`✗ ${ref.title.slice(0, 60)} — ${msg.slice(0, 80)}`);
        } finally {
          completedCount++;
          doneDurSec += durOf(videoId);
          const fracDone =
            totalDurSec > 0 ? doneDurSec / totalDurSec : completedCount / totalVideos;
          const elapsedSec = (Date.now() - loopStart) / 1000;
          await metadata.set("progress", {
            current: completedCount,
            total: totalVideos,
            phase: "processing videos",
            detail: `[${completedCount}/${totalVideos}] ${ref.title.slice(0, 60)}`,
            fracDone: Math.round(fracDone * 1000) / 1000,
            ...((completedCount >= VIDEO_CONCURRENCY || fracDone >= 0.25) &&
            completedCount < totalVideos &&
            fracDone > 0.05
              ? {
                  estSecondsRemaining: Math.max(
                    0,
                    Math.round(elapsedSec / fracDone - elapsedSec),
                  ),
                }
              : {}),
          });
          await db
            .update(pipelineRuns)
            .set({ progress: analyzed })
            .where(eq(pipelineRuns.id, payload.runId));
        }
      };

      const concurrency = pLimit(VIDEO_CONCURRENCY);
      await Promise.all(selected.map((ref) => concurrency(() => processOneVideo(ref))));
      selectedCount = selected.length;

      if (proxyPool) {
        const flushed = await flushProxyPool(db, proxyPool);
        const stats = proxyPool.stats();
        logger.info(
          `Pool flushed: ${flushed.updatedSessions} sessions touched, ${flushed.newlyDisabled} newly disabled. ` +
            `alive=${stats.alive}/${stats.total} bytes=${JSON.stringify(stats.bytesByProvider)} ok=${JSON.stringify(stats.okByProvider)} err=${JSON.stringify(stats.errByProvider)}`,
        );
      }
      }

      let sopsGenerated = 0;
      // Incremental with 0 new videos still regenerates: existing SOPs may be missing or stale.
      const shouldRegenerateSops =
        analyzed > 0 || (payload.mode === "incremental" && selectedCount === 0);
      if (shouldRegenerateSops) {
        await metadata.set("progress", {
          current: 0,
          total: 3,
          phase: "compiling videos data",
          detail: "汇总已分析视频，准备 SOP 提示词",
        });
        const channelVideos = await db
          .select()
          .from(clerkVideos)
          .where(ownerVideoCond)
          .orderBy(sql`${clerkVideos.views} DESC NULLS LAST`);

        const summedViews = channelVideos.reduce(
          (sum, v) => sum + (typeof v.views === "number" ? v.views : 0),
          0,
        );
        // null when there is no real view data — the prompt then says "unavailable" instead of "Total views: 0".
        const totalViews = summedViews > 0 ? summedViews : null;
        const date = new Date().toISOString().split("T")[0]!;
        const transcriptCount = channelVideos.filter(
          (v) =>
            !!v.transcript &&
            ["xhs_asr", "douyin_asr", "caption", "asr"].includes(v.transcriptSource ?? ""),
        ).length;

        // MAP step: a per-video pattern summary, cached on the row, so the reduce works over
        // summaries instead of full transcripts.
        const mapContentType = (v: typeof clerkVideos.$inferSelect) =>
          v.contentType === "xhs_video" ||
          v.contentType === "xhs_image" ||
          v.contentType === "douyin_video" ||
          v.contentType === "douyin_image"
            ? (v.contentType as "xhs_video" | "xhs_image" | "douyin_video" | "douyin_image")
            : ("video" as const);
        const summaries = new Map<string, string>();
        let mapComputed = 0;
        let mapFailed = 0;
        const mapLimit = pLimit(VIDEO_CONCURRENCY);
        await Promise.all(
          channelVideos.map((v) =>
            mapLimit(async () => {
              const cached = safeText(v.sopMapSummary);
              if (cached) {
                summaries.set(v.id, cached);
                return;
              }
              try {
                const summary = await summarizeVideoForSop({
                  title: v.title,
                  views: v.views,
                  durationSec: v.durationSec,
                  contentType: mapContentType(v),
                  transcript: v.transcript,
                  analysis: renderVideoAnalysisFields(v),
                  language,
                  logger,
                });
                summaries.set(v.id, summary);
                await db
                  .update(clerkVideos)
                  .set({ sopMapSummary: summary })
                  .where(eq(clerkVideos.id, v.id));
                mapComputed++;
              } catch (err) {
                // One failing video must not abort SOP generation; the column stays null so it retries.
                mapFailed++;
                logger.warn(
                  `SOP map summary failed for "${v.title.slice(0, 50)}" — using structured-field fallback: ${(err as Error).message?.slice(0, 120)}`,
                );
                const fallback = renderVideoAnalysisFields(v);
                if (fallback) summaries.set(v.id, fallback);
              }
            }),
          ),
        );
        logger.info(
          `SOP map step: ${summaries.size}/${channelVideos.length} videos summarized (computed=${mapComputed}, cached=${summaries.size - mapComputed - mapFailed}, fallback=${mapFailed})`,
        );

        const reduceBlocks = channelVideos.map((v, i) =>
          renderVideoSummaryBlock(v, summaries, i + 1),
        );
        const reduceLimit = pLimit(VIDEO_CONCURRENCY);
        const videosData = await buildReducedVideosData({
          blocks: reduceBlocks,
          language,
          videoCount: channelVideos.length,
          limitFn: (fn) => reduceLimit(fn),
        });

        let hottestCommentsSummary: string | null = null;
        const topVid = channelVideos[0];
        // null when the platform can't fetch comments: XHS has no comments wiring, YouTube
        // needs the proxy pool.
        const fetchTopComments: (() => Promise<Array<{ text: string; likes: number }>>) | null =
          channel.platform === "douyin"
            ? async () =>
                (await getDouyinTopComments(topVid!.platformVideoId!, 100)).map((c) => ({
                  text: c.text,
                  likes: c.diggCount,
                }))
            : channel.platform === "youtube" && proxyPool
              ? async () => {
                  const session = proxyPool.checkout();
                  const out = await getTopCommentsYtdlp(topVid!.platformVideoId!, session.url, 100);
                  proxyPool.reportOk(session, 30_000);
                  return out;
                }
              : null;
        if (fetchTopComments && topVid?.platformVideoId) {
          try {
            const comments = await fetchTopComments();
            if (comments.length >= 5) {
              const summaryPrompt = buildCommentsSummaryPrompt({
                videoTitle: topVid.title,
                comments,
                language,
              });
              const sumResult = await generateText({
                model: llm("flash"),
                prompt: summaryPrompt,
                maxOutputTokens: 1500,
                temperature: 0.3,
                maxRetries: 2,
              });
              const parsed = await parseCommentsSummaryJson(sumResult.text);
              if (parsed) {
                hottestCommentsSummary = formatCommentsSummary(parsed);
                logger.info(
                  `Top comments summarized for hottest SOP: ${comments.length} → ${hottestCommentsSummary.length} chars`,
                );
              } else {
                logger.warn("Comments summary JSON parse failed");
              }
            } else {
              logger.info(
                `Top video has ${comments.length} comments (<5) — skipping comment summary`,
              );
            }
          } catch (err) {
            logger.warn(
              `Comments fetch/summary failed (non-blocking): ${(err as Error).message?.slice(0, 200)}`,
            );
          }
        }

        // Each SOP is grounded against the material its prompt received — hottest reads the full
        // transcript, and checking it against the map summaries redacted legitimate quotes.
        const sopSteps: Array<{
          type: "human" | "ai_reference" | "hottest";
          phase: string;
          buildPrompt: () => string | null;
          groundingSource: () => string;
        }> = [
          {
            type: "human",
            phase: "generating human SOP",
            buildPrompt: () =>
              buildHumanSopPrompt({
                channelName: channel.name,
                videoCount: channelVideos.length,
                totalViews,
                date,
                videosData,
                transcriptCount,
                language,
              }),
            groundingSource: () => videosData,
          },
          {
            type: "ai_reference",
            phase: "generating AI reference SOP",
            buildPrompt: () =>
              buildAiSopReferencePrompt({
                channelName: channel.name,
                videoCount: channelVideos.length,
                totalViews,
                date,
                videosData,
                transcriptCount,
                language,
              }),
            groundingSource: () => videosData,
          },
          {
            type: "hottest",
            phase: "generating hottest video deep dive",
            buildPrompt: () => {
              const top = channelVideos[0];
              if (!top || !top.transcript) {
                logger.warn(
                  `Hottest SOP skipped: ${
                    !top ? "no analyzed videos" : `top video "${top.title}" has no transcript`
                  }`,
                );
                return null;
              }
              // Top-engagement XHS/Douyin items are routinely image posts; the video prompt
              // would bind a time axis to a 0-second "video".
              return top.contentType.endsWith("_image")
                ? buildImagePostSopPrompt({
                    channelName: channel.name,
                    title: top.title,
                    engagementScore: top.views ?? null,
                    url: top.url,
                    caption: top.transcript,
                    coverDescription: top.thumbnailDescription,
                    coverWhyItWorks: top.thumbnailWhyItWorks,
                    coverDiagnosis: top.coverDiagnosis,
                    coverTitleSuggestions: top.coverTitleSuggestions,
                    coverVisionAt: top.coverVisionAt,
                    analysisSummary: summarizeAnalysis(top),
                    commentsSummary: hottestCommentsSummary,
                  })
                : buildHottestSopPrompt({
                    channelName: channel.name,
                    title: top.title,
                    views: top.views ?? null,
                    durationSec: top.durationSec ?? 0,
                    url: top.url,
                    transcript: top.transcript,
                    analysisSummary: summarizeAnalysis(top),
                    commentsSummary: hottestCommentsSummary,
                    language,
                  });
            },
            groundingSource: () => {
              const top = channelVideos[0];
              if (!top) return videosData;
              const coverAnalyzed = Boolean(
                top.coverVisionAt || top.coverDiagnosis || top.coverTitleSuggestions?.length,
              );
              return [
                top.transcript,
                summarizeAnalysis(top),
                hottestCommentsSummary,
                ...(coverAnalyzed
                  ? [top.thumbnailDescription, top.thumbnailWhyItWorks, top.coverDiagnosis]
                  : []),
              ]
                .filter(Boolean)
                .join("\n\n");
            },
          },
        ];

        await metadata.set("progress", {
          current: 0,
          total: sopSteps.length,
          phase: "generating SOPs",
          detail: `${sopSteps.length} 个 SOP 并行生成中（约 3-5 分钟）`,
        });
        appendLog(`开始并行生成 ${sopSteps.length} 个 SOP`);

        let sopsCompleted = 0;
        const regeneratedTypes = new Set<"human" | "ai_reference" | "hottest">();
        await Promise.all(
          sopSteps.map(async (step) => {
            const prompt = step.buildPrompt();
            if (!prompt) {
              logger.info(`Skipping ${step.type} SOP (preconditions not met)`);
              return;
            }
            try {
              // 16384 cap: ai_reference truncated at 12000 on rich multi-video channels.
              const sopResult = await generateText({
                model: llm("pro"),
                prompt,
                maxOutputTokens: 16384,
                temperature: 0.4,
                maxRetries: 2,
              });
              const cleaned = safeText(sopResult.text);
              if (!cleaned) {
                logger.warn(`Empty ${step.type} SOP response`);
                return;
              }
              // ai_reference stays English, so the grounding pass must be tagged English.
              const grounded = await redactUngrounded({
                draft: cleaned,
                source: step.groundingSource(),
                language: step.type === "ai_reference" ? "en" : language,
                logger,
              });
              const [newSop] = await db
                .insert(clerkSops)
                .values({
                  ...owner,
                  sopType: step.type,
                  language,
                  contentMd: grounded,
                  runId: payload.runId,
                  // Attributes the hottest deep-dive to its source video; channel-level SOPs keep NULL.
                  videoId: step.type === "hottest" ? (channelVideos[0]?.id ?? null) : null,
                })
                .returning({ id: clerkSops.id });
              // Swap only after the new SOP lands so the UI never goes blank; also drops leftovers
              // from a retry of this run (run_id is stable). Competitor SOPs are never auto-bound.
              if (newSop) {
                await db
                  .delete(clerkSops)
                  .where(
                    and(
                      isOwn
                        ? eq(clerkSops.channelId, channel.id)
                        : eq(clerkSops.competitorAccountId, channel.id),
                      eq(clerkSops.sopType, step.type),
                      ne(clerkSops.id, newSop.id),
                    ),
                  );
                if (isOwn) {
                  await db
                    .insert(projectSops)
                    .values({
                      projectId: channel.id,
                      sopId: newSop.id,
                      role: step.type === "ai_reference" ? "primary" : "reference",
                    })
                    .onConflictDoNothing();
                }
                regeneratedTypes.add(step.type);
              }
              sopsGenerated++;
              sopsCompleted++;
              appendLog(`✓ ${step.type} SOP 完成`);
              await metadata.set("progress", {
                current: sopsCompleted,
                total: sopSteps.length,
                phase: "generating SOPs",
                detail: `${step.type} 完成 (${sopsCompleted}/${sopSteps.length})`,
              });
            } catch (err) {
              const msg = (err as Error).message;
              console.error(`[analyze-channel] SOP ${step.type} failed:`, msg);
              logger.error(`SOP ${step.type} failed`, { message: msg.slice(0, 500) });
            }
          }),
        );

        // Scoped to regenerated types: one that failed or was skipped keeps its previous SOP.
        if (regeneratedTypes.size > 0) {
          await db
            .delete(clerkSops)
            .where(
              and(
                isOwn
                  ? eq(clerkSops.channelId, channel.id)
                  : eq(clerkSops.competitorAccountId, channel.id),
                inArray(clerkSops.sopType, [...regeneratedTypes]),
                or(ne(clerkSops.runId, payload.runId), isNull(clerkSops.runId)),
              ),
            );
        }
      }

      // All items failed → fail the run (refund via withRunDb) instead of a silent "done" with
      // 0 output; incremental with 0 new items is a legitimate no-op.
      if (selectedCount > 0 && analyzed === 0 && payload.mode !== "incremental") {
        throw new Error(`所有 ${selectedCount} 个内容处理失败，无产出`);
      }

      // Settle parse quota from the videos this run actually stamped (duration-weighted).
      if (payload.userId) {
        const processed = await db
          .select({ durationSec: clerkVideos.durationSec })
          .from(clerkVideos)
          .where(eq(clerkVideos.runId, payload.runId));
        const minutes = processed.reduce((s, v) => s + videoMinutes(v.durationSec), 0);
        await settleRunMinutes(db, { runId: payload.runId, userId: payload.userId, minutes });
      }

      await db
        .update(pipelineRuns)
        .set({ status: "done", completedAt: new Date() })
        .where(eq(pipelineRuns.id, payload.runId));

      return {
        analyzed,
        failed,
        degradedToText,
        total: selectedCount,
        sopsGenerated,
        channelName: channel.name,
      };
    });
  },
});
