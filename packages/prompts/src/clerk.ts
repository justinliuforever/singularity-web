export const XHS_IMAGE_PREAMBLE = `NOTE: This is a Xiaohongshu (小红书) IMAGE post, not a video. Adapt your analysis:
- "thumbnail_description" → describe the cover image composition and visual hook
- "opening_hook" → the title and first line of text that hooks the reader
- "opening_hook_type" → classify the text hook type (e.g., "Question", "Bold Claim", "List Preview")
- "hooks_throughout" → text hooks, section breaks, and emotional pivots in the post body (no timestamps — use section numbers)
- "script_structure" → text structure: intro → body sections → conclusion/CTA
- "duration_sec" is not applicable; focus on text flow and reading engagement
- The "transcript" below is the post's full text content (title + description)
- "Views" shown is actually a weighted engagement score (likes + collects + comments + shares)
- IMPORTANT: there is NO timeline. For ALL keys (incl. opening_structure, script_structure, rehooks_used, retention_pattern, cta_placement, key_takeaways), cite section numbers or reading order (开头 / 第2段 / 结尾), NEVER [m:ss] timestamps. Ignore any instruction below that asks for [m:ss] — it does not apply to image posts.
`;

export const XHS_VIDEO_PREAMBLE = `NOTE: This is a Xiaohongshu (小红书) short video post, not a YouTube video.
- The engagement metric shown as "Views" is a weighted engagement score (likes + collects + comments + shares), not actual view count
- XHS videos are typically short-form (30s-3min). Analyze hooks and retention for short-form content
- The "transcript" may include both the post description text and a Whisper-transcribed audio track
- The transcript has NO timestamps — estimate timing based on word count and duration_sec, but clearly mark estimates as approximate (e.g., "~0-10s")
- Do NOT fabricate specific timestamps that are not in the transcript
- IMPORTANT: for ANY key that asks for [m:ss] (opening_structure, script_structure, rehooks_used, retention_pattern, cta_placement, key_takeaways), use APPROXIMATE ranges like "~0-10s" or "~中段" — never invent precise [m:ss] markers. Ignore instructions below demanding exact [m:ss]; this post has no real timeline.
`;

export const DOUYIN_IMAGE_PREAMBLE = `NOTE: This is a Douyin (抖音) IMAGE-CAROUSEL post (图文), not a video. Adapt your analysis:
- "thumbnail_description" → describe the first image's composition and visual hook
- "opening_hook" → the caption's title line and first sentence that hooks the reader
- "opening_hook_type" → classify the text hook type (e.g., "Question", "Bold Claim", "List Preview")
- "hooks_throughout" → text hooks, slide breaks, and emotional pivots across the carousel (no timestamps — use slide/section numbers)
- "script_structure" → text structure: intro → body sections → conclusion/CTA
- "duration_sec" is not applicable; focus on text flow and reading engagement
- The "transcript" below is the post's full caption text (title + description + hashtags)
- "Views" shown is a weighted engagement score (likes + collects + comments + shares) unless labeled as real plays
- IMPORTANT: there is NO timeline. For ALL keys (incl. opening_structure, script_structure, rehooks_used, retention_pattern, cta_placement, key_takeaways), cite slide/section numbers or reading order (开头 / 第2张 / 结尾), NEVER [m:ss] timestamps. Ignore any instruction below that asks for [m:ss] — it does not apply to image posts.
`;

export const DOUYIN_VIDEO_PREAMBLE = `NOTE: This is a Douyin (抖音) video, not a YouTube video.
- The engagement metric shown as "Views" may be a weighted engagement score (likes + collects + comments + shares) when real play counts are unavailable
- Douyin spans short-form (15s-3min) to long-form (10min+). Judge hooks and retention against the actual duration_sec
- The "transcript" may include both the caption text (title + hashtags) and an ASR-transcribed audio track
- The transcript has NO timestamps — estimate timing based on word count and duration_sec, but clearly mark estimates as approximate (e.g., "~0-10s")
- Do NOT fabricate specific timestamps that are not in the transcript
- IMPORTANT: for ANY key that asks for [m:ss] (opening_structure, script_structure, rehooks_used, retention_pattern, cta_placement, key_takeaways), use APPROXIMATE ranges like "~0-10s" or "~中段" — never invent precise [m:ss] markers. Ignore instructions below demanding exact [m:ss]; this transcript has no real timeline.
`;

// Shared by CHINESE_WRAPPER (Clerk SOP + Bible) and the Poet zh script prompts.
export const ZH_STYLE_GUIDE = `用简体中文输出全文。这是给中国内容创作者看的实战手册，必须读起来像一个资深中文编导在讲话，不能有翻译腔或 AI 腔。

## 术语对照（按下面的说法写，禁止直译生造词）
- call to action / CTA → 「引导动作」或直接「CTA」；禁止「社会仪式 CTA」
- signature move → 「IP 标志性动作」；禁止「签名式动作」
- theme / thematic cluster → 「常见主题」或「核心话题」；禁止「主题聚类」
- pattern interrupt / cognitive schema / "bomb" → 「黄金前 3 秒钩子」「打断刷视频的惯性」「完播率痛点」「避免观众划走」；禁止「认知基模」「炸弹」「阻止滑动」
- cognitive lever / psychology → 「为什么管用（底层心理）」「心理钩子」；禁止「认知杠杆」
- hook → 钩子；open loop → 留扣子 / 悬念；rehook → 二次抓人；reframe → 换个说法 / 重新定义
- retention → 完播 / 留人；specificity spike → 具体细节抓人点；payload → 干货 / 正片；setup → 铺垫；beat → 节奏段
- Master Formula → 核心公式；Retention Tape → 留人时间轴；Viewer Resonance → 观众为什么买账；Emotional Escalation Map → 情绪递进图；Narrative Arc → 故事弧线
- 禁止这些中文生造直译：开放回路 / 打开回路 → 留扣子·悬念；模式打断 / 模式打破 → 打断惯性·换个节奏；认知杠杆 → 心理钩子；视觉锤 → 视觉记忆点；留人钉 → 留人点；情绪过山车 → 情绪起伏；社交证据 → 大家都在追。
- 其它英文行话一律换成中文创作者圈通用说法；专有名词、品牌名、逐字引用、[m:ss] 时间戳保持原样。

## 写法要求（去翻译腔 / 去 AI 腔）
- 不要虚化动词：别用「进行 / 加以 / 予以 / 给予 + 名词」，直接用动词。
- 少用被动「被」，改主动。
- 删掉八股套话：「值得注意的是」「总而言之」「众所周知」「……之一」。
- 短句、口语化；不要名词堆叠长句。
- 介词别硬译：of / about / as 不要一律译成「关于 / 对于」。
- 不用 emoji，不写「让我们一起」「希望对你有帮助」「好的，以下是」这类客套与复述指令。

## 不编造（重要）
- 只写素材里确有依据的具体信息（产品名、价格、参数、人名、账号、数据、引语）。
- 素材没有的具体事实别编：改成泛化说法，或标「待核实」，或干脆不写——别为了凑细节去编型号·价格·规格·账号·日期。
- 数字 / 价格 / 型号 / 人名按素材原样写，不改写、不四舍五入。
- [m:ss] 时间戳只用素材里真实存在的；素材没有时间戳就别编。
- 没把握的不要当成事实陈述。`;

export const CHINESE_WRAPPER = (innerPrompt: string) =>
  `${ZH_STYLE_GUIDE}

${innerPrompt}`;

// en path only — the zh equivalent (不编造) lives in ZH_STYLE_GUIDE.
const QUOTE_GROUNDING_EN =
  'Put a phrase in quotation marks and attach a [Video N]/[Partial N] source citation ONLY if that exact phrase appears verbatim in the provided summaries/partials. If you are paraphrasing, generalizing, or inferring, do NOT use quotation marks and do NOT attach a source citation. Never invent example lines, prompt fragments, numbers, names, or rhetorical questions and present them as sourced.';

// Translating a quote and then citing it is fabrication, so quotes stay in the transcript's
// language. Only for the MAP -> partial-reduce -> SOP chain, NOT ZH_STYLE_GUIDE — a zh Poet
// script legitimately wants full Chinese.
const KEEP_QUOTE_LANG_EN =
  "Quoted evidence — any phrase in quotation marks plus its [m:ss] — MUST be copied VERBATIM in the transcript's ORIGINAL language; never translate a quoted line. Your synthesis/prose may be in the target language, but a quote stays in its source language exactly as written — otherwise drop the quotation marks and the citation (it is not a quote).";
const KEEP_QUOTE_LANG_ZH =
  "【原文引用·重要】带引号的证据短语（连同 [m:ss]）必须按转写的原始语言逐字照抄，绝不翻译；把英文台词译成中文再加引号当出处 = 编造。你自己的归纳用中文，但引语保持原文，否则就别加引号和出处。";

type SponsorChapterArg = {
  start_time: number;
  end_time: number;
  category: string;
};

type ChapterArg = {
  start_time: number;
  end_time: number;
  title: string;
};

type VideoAnalysisArgs = {
  title: string;
  views: number | null;
  durationSec: number | null;
  thumbnailUrl: string | null;
  transcript: string | null;
  chapters?: ChapterArg[];
  sponsorChapters?: SponsorChapterArg[];
  contentType?: 'video' | 'xhs_image' | 'xhs_video' | 'douyin_image' | 'douyin_video';
  language?: 'en' | 'zh';
};

const NO_TRANSCRIPT_PLACEHOLDER =
  '[No transcript available — analyze based on title and thumbnail only]';

function fmtTs(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `[${m}:${s.toString().padStart(2, '0')}]`;
}

export function buildVideoAnalysisPrompt(args: VideoAnalysisArgs): string {
  const contentType = args.contentType ?? 'video';
  const language = args.language ?? 'en';

  const preamble =
    contentType === 'xhs_image'
      ? XHS_IMAGE_PREAMBLE
      : contentType === 'xhs_video'
        ? XHS_VIDEO_PREAMBLE
        : contentType === 'douyin_image'
          ? DOUYIN_IMAGE_PREAMBLE
          : contentType === 'douyin_video'
            ? DOUYIN_VIDEO_PREAMBLE
            : '';

  const isVideo = contentType === 'video';
  const timestampInstruction = isVideo
    ? `

## Critical: timestamp citations
The transcript above contains [m:ss] markers every ~6 seconds. EVERY hook, structural beat, and rehook MUST quote the exact [m:ss] marker present in the transcript. Format: \`[m:ss] "exact quoted line"\`. Do NOT invent timestamps that are not in the transcript. Do NOT use percentages or relative positions ("intro", "midpoint") — use the [m:ss] anchor.`
    : '';

  const chaptersBlock =
    isVideo && args.chapters && args.chapters.length > 0
      ? `\n\n## Chapters (creator-defined — these are ground-truth structural intent)\n${args.chapters
          .map((c) => `${fmtTs(c.start_time)}-${fmtTs(c.end_time)} ${c.title}`)
          .join(
            '\n',
          )}\n\nWhen these chapters exist, ALIGN your \`opening_structure\` and \`script_structure\` to the chapter boundaries. Quote or paraphrase the chapter titles — they are the creator's own intent labels.`
      : '';

  // sponsor/selfpromo spans are already stripped from the transcript; listed here only
  // so the model knows their bounds.
  const sponsorBlock =
    isVideo && args.sponsorChapters && args.sponsorChapters.length > 0
      ? `\n\n## SponsorBlock markers (authoritative timestamps; sponsor/selfpromo content already removed from transcript)\n${args.sponsorChapters
          .map(
            (c) =>
              `${fmtTs(c.start_time)}-${fmtTs(c.end_time)} [${c.category}]`,
          )
          .join(
            '\n',
          )}\n\nWhen \`hook\`/\`intro\` markers exist, use those as the opening_hook boundary. When \`interaction\`/\`outro\` markers exist, use them for cta_placement. Do NOT infer hook/CTA from spans labeled \`sponsor\` or \`selfpromo\` — those are ads, not content.`
      : '';

  const body = `You are an expert content analyst. Analyze this content and extract structured data about its scripting techniques.

## Video Information
- **Title:** ${args.title}
- **Views:** ${args.views?.toLocaleString('en-US') ?? 'unknown'}
- **Duration:** ${args.durationSec ?? 'unknown'} seconds
- **Thumbnail URL:** ${args.thumbnailUrl ?? 'unknown'}
${chaptersBlock}${sponsorBlock}

## Full Transcript
${args.transcript ?? NO_TRANSCRIPT_PLACEHOLDER}
${timestampInstruction}

## Instructions

Analyze this video and return a JSON object with these exact keys:

1. **thumbnail_description**: You CANNOT see the cover image. Never state or guess what it actually shows — no "the cover is likely…", no inferred subjects, colours, or layout. Write a RECOMMENDATION instead: what an effective cover for this content would include, phrased as advice ("建议…" / "A strong cover here would…"). A later vision pass overwrites this field with a real read when the image is available; anything you write here that reads as an observation becomes a fabricated one.
2. **thumbnail_why_it_works**: Same rule — reason only from the title's hook and topic about which visual elements would make a cover effective. Do not describe the existing cover.
3. **opening_hook**: Detailed breakdown of the opening hook (first 10-15 seconds). Quote the exact opening text with [0:00]-[0:15] timestamp anchors.
4. **opening_hook_type**: Classify the opening hook type.
5. **hooks_throughout**: Identify ALL hooks used throughout the ENTIRE video. For EACH: \`[m:ss] [Hook Name] ([Hook Type]): "exact quoted text" — [Explanation of why this hook works at this moment]\`. Aim for 4-8 hooks across the duration.
6. **all_hook_types**: List ALL distinct hook types used, separated by commas.
7. **text_hook**: Templatized version of the opening hook with [PLACEHOLDER] variables — abstract the structural pattern, not the literal words.
8. **framework**: The overall content framework used (e.g. "Problem → Agitate → Solve", "Listicle", "Tutorial", "Story-driven explainer").
9. **opening_structure**: First 30 seconds beat-by-beat with timestamps. Each beat: \`[m:ss-m:ss] [Beat Name]: what happens\`.
10. **script_structure**: Full beat-by-beat breakdown for the WHOLE video. Each beat: \`[m:ss-m:ss] [Beat Name]: what happens\`. Aim for 6-12 beats. Do NOT use percentages.
11. **storytelling_framework**: The primary storytelling technique. Include: (a) framework name, (b) narrative arc shape, (c) main story beats with timestamps, (d) signature emotional moves.
12. **rehooks_used**: List the specific re-hook phrases used. For each: \`[m:ss] "exact phrase"\`. These are the recurring "stay tuned for X" / "but here's the crazy part" lines.
13. **retention_pattern**: How the video maintains retention. Include: (a) open loops opened + when closed (with timestamps), (b) specificity spikes (concrete numbers/names/dates) with timestamps, (c) pattern breaks with timestamps, (d) recap/preview moments.
14. **cta_placement**: Where and how CTAs appear, with timestamps.
15. **key_takeaways**: 3-5 bullet points on what makes this video's script effective. Cite at least one timestamped example per takeaway.

**Grounding (important):** Base every field ONLY on what the transcript above actually contains. If the transcript is clearly partial or very short (e.g. only the first few seconds), analyze just what is present and say so plainly — do NOT fabricate timestamps, defects, prices, comparisons, or beats that are not in the transcript.

Return ONLY valid JSON. No markdown code fences.
`;

  const composed = preamble + body;
  if (language !== 'zh') return composed;
  return (
    CHINESE_WRAPPER(composed) +
    '\n\nIMPORTANT: JSON keys must remain in English (thumbnail_description, opening_hook, framework, …). Only the VALUES (the strings on the right side) should be in Simplified Chinese.'
  );
}

type VideoMapSummaryArgs = {
  title: string;
  views: number | null;
  durationSec: number | null;
  contentType?: 'video' | 'xhs_image' | 'xhs_video' | 'douyin_image' | 'douyin_video';
  transcript: string | null;
  analysis: string;
  language?: 'en' | 'zh';
};

// MAP step of the SOP map-reduce: the reduce synthesizes over these summaries rather than
// raw transcripts, which is what bounds its context.
export function buildVideoMapSummaryPrompt(args: VideoMapSummaryArgs): string {
  const language = args.language ?? 'en';
  const contentType = args.contentType ?? 'video';
  // douyin_video reads as "video" but its metric is still an engagement proxy.
  const isVideo = contentType === 'video' || contentType === 'douyin_video';
  const hasRealViews = contentType === 'video';
  const hasTimestamps = !!args.transcript && /\[\d+:\d{2}\]/.test(args.transcript);

  const tcRule = !args.transcript
    ? 'There is NO transcript for this video — work only from the title, cover signals, and the structured analysis below. Do NOT quote spoken lines, cite [m:ss], or invent a beat-by-beat structure; keep claims at the title/cover-pattern level and label inferences.'
    : hasTimestamps
      ? 'When you cite a moment, use the [m:ss] markers that actually appear in the transcript. Never invent a timecode.'
      : 'This transcript carries NO [m:ss] markers — locate moments approximately (opening / early / mid / late). Do NOT fabricate timecodes.';

  const garbledRule =
    'If the transcript is empty, garbled, clearly off-topic relative to the title, or in a language inconsistent with the title/content (a likely ASR error), TREAT IT AS NO TRANSCRIPT — do not quote or extract any lines, phrases, or parameters from it. Infer only from the title/cover and explicitly label those as inference. Never present an invented or ASR-noise line as a verbatim quote.';

  const transcriptBlock = args.transcript
    ? args.transcript.slice(0, 12000)
    : '[No transcript available — use title, cover signals, and the structured analysis only]';

  const inner = `You are an expert content analyst distilling ONE ${
    isVideo ? 'video' : 'post'
  } into a compact "playbook contribution" for a creator's scriptwriting SOP. Extract the TRANSFERABLE techniques this single piece demonstrates — the reusable patterns a writer could apply to a new piece — each backed by brief concrete evidence from the source.

## Source Information
- **Title:** ${args.title}
- **${hasRealViews ? 'Views' : 'Engagement score'}:** ${args.views?.toLocaleString('en-US') ?? 'unknown'}
- **Duration:** ${args.durationSec ?? 'unknown'} seconds

## Structured Analysis
${args.analysis || '(no structured analysis available)'}

## Transcript${args.transcript ? '' : ' (unavailable)'}
${transcriptBlock}

## Instructions
Write compact markdown bullets (no headers above ###) covering, where the source supports it:
- **Opening hook**: the hook type used and why it works, with the opening line as brief evidence.
- **Structure / framework**: the overall content framework and the shape of the script.
- **Retention & re-hooks**: open loops, rehook phrases, specificity spikes, pattern breaks, and pacing.
- **CTA**: where and how the call-to-action appears.
- **Signature moves**: any distinctive recurring devices, catchphrases, or structural tics.
- **Cover**: name the transferable cover move this piece uses — the concrete device (composition / colour / overlay text / subject / prop) and why it earns the click, plus its weakest point. Base this ONLY on the \`cover_diagnosis\` line in the structured analysis above; if there is none, omit this bullet entirely rather than guessing from the title. Keep it to 1-2 sentences: the SOP receives the full cover read separately, so do not restate it here.

Constraints:
- ${tcRule}
- ${garbledRule}
- ${KEEP_QUOTE_LANG_EN}
- Ground EVERY claim in the title, structured analysis, or transcript above — do NOT invent specifics (prices, names, stats, quotes, timecodes) that are not present.
- Keep it tight: ~300-550 words, compact bullets, NO preamble and NO closing summary. Start directly with the first bullet.`;

  return language === 'zh' ? `${CHINESE_WRAPPER(inner)}\n\n${KEEP_QUOTE_LANG_ZH}` : inner;
}

type SopPartialReduceArgs = {
  // Concatenated buildVideosSummaryText output for ONE chunk of videos.
  videosData: string;
  language?: 'en' | 'zh';
};

// Intermediate reduce: its output feeds BOTH SOP types, so it must stay neutral — no SOP
// template structure, no English-only assumption.
export function buildSopPartialReducePrompt(args: SopPartialReduceArgs): string {
  const language = args.language ?? 'en';
  const inner = `You are consolidating the per-video pattern summaries of ONE batch of a creator's videos into a single compact "partial pattern set". A later step merges several of these partials into the channel's full scriptwriting SOP, so capture this batch's transferable patterns faithfully — nothing should be lost.

## This batch's per-video pattern summaries
${args.videosData}

## Instructions
Write compact markdown bullets (no headers above ###) synthesizing ACROSS the videos in this batch, covering where the summaries support it:
- **Opening hooks**: the recurring hook types and any distinctive one-offs, with a brief grounded example each.
- **Structure / framework**: the shared content frameworks and script shapes; note variants.
- **Retention & re-hooks**: recurring open loops, rehook phrases, specificity spikes, pattern breaks, pacing.
- **CTA**: how and where calls-to-action recur.
- **Signature moves**: distinctive recurring devices, catchphrases, or structural tics across this batch.
- **Covers**: recurring cover/thumbnail patterns and recurring weaknesses, carried through from the per-video cover notes. Keep each tied to its video so the SOP can build a per-video diagnostic; omit if the summaries carry no cover notes.

Constraints:
- Ground EVERY claim in the summaries above — never invent specifics (prices, names, stats, quotes, timecodes) not present. Carry through only the verbatim quotes and [m:ss] timecodes that already appear in the summaries; if a summary has no timecodes, locate moments approximately (opening / early / mid / late), never fabricate.
- ${QUOTE_GROUNDING_EN}
- ${KEEP_QUOTE_LANG_EN}
- Distinguish patterns that recur across multiple videos from one-offs; do not assert frequency counts beyond what the summaries state.
- Keep it tight: ~400-700 words, compact bullets, NO preamble and NO closing summary. Start directly with the first bullet.`;
  return language === 'zh' ? `${CHINESE_WRAPPER(inner)}\n\n${KEEP_QUOTE_LANG_ZH}` : inner;
}

type SopArgs = {
  channelName: string;
  videoCount: number;
  totalViews: number | null;
  date: string;
  videosData: string;
  language?: 'en' | 'zh';
  transcriptCount?: number;
};

function transcriptCoverageNote(transcriptCount: number | undefined, total: number): string {
  const tc = transcriptCount ?? total;
  if (tc >= total) return '';
  if (tc <= 0) {
    return `⚠️ TRANSCRIPT COVERAGE: 0 of ${total} analyzed videos have a transcript (audio/captions unavailable). You have NO spoken source — do NOT produce [m:ss] timestamps, verbatim quotes, beat-by-beat timelines, EXAMPLE_OPENING lines, narrative-arc timestamps, or per-video frequency counts (they would be fabricated). Build only from titles + cover/thumbnail signals, keep it at the title/cover-pattern level, and state this limitation plainly at the top.\n\n`;
  }
  return `⚠️ TRANSCRIPT COVERAGE: only ${tc} of ${total} analyzed videos have a transcript. Use [m:ss], verbatim quotes, and timelines ONLY for the videos that have one; for the rest work from title/cover and never invent timecodes or quotes.\n\n`;
}

export function buildHumanSopPrompt(args: SopArgs): string {
  const viewsClause =
    args.totalViews && args.totalViews > 0
      ? `total views analyzed: ${args.totalViews.toLocaleString('en-US')}`
      : 'view counts unavailable for these videos';
  const subtitleViews =
    args.totalViews && args.totalViews > 0
      ? `Total views: ${args.totalViews.toLocaleString('en-US')}`
      : 'View counts unavailable';
  const inner = `You are an expert YouTube content strategist. Based on the analysis of the top ${args.videoCount} most-viewed videos from the channel "${args.channelName}" (${viewsClause}), create a comprehensive Scriptwriting Standard Operating Procedure that a writer could pick up and use to produce a new video in this channel's voice.

The data below is a set of per-video pattern summaries — each one distills a single video's reusable techniques (hook, structure, retention, CTA, signature moves). Synthesize ACROSS them to find the channel's repeated patterns; do not just restate one video.

## Analyzed Videos Data
${args.videosData}

## Output requirements

**Title:** "${args.channelName} Scriptwriting Standard Operating Procedure"
**Subtitle:** "Based on analysis of Top ${args.videoCount} most-viewed videos | ${subtitleViews} | Generated: ${args.date}"

**Table of Contents** (required): markdown bullet list linking to all numbered sections AND both appendices by name. Include sub-headings (e.g. 5.1, 6.1, Appendix A, Appendix B).

**Section 1: Master Formula**
1A. Express the channel's content formula as a one-line equation, e.g. \`Hook (specific claim) → Setup (origin / stakes) → Payload (3-5 demonstrations) → Reframe (lesson) → CTA\`. Then break each variable down with a short paragraph and concrete examples from the analyzed videos. Cite at least two video titles per variable. This is the single most important section.

1B. **Content Pillars** sub-section: cluster the analyzed videos into 3-5 content pillars by purpose (e.g. "Beginner Guides", "Gear Philosophy", "News Reactions"). For each pillar list 2-4 example video titles with their view counts.

**Section 2: Common Themes & Brand Voice**
2A. Cluster the analyzed videos into 3-6 recurring themes. For each theme: name, ratio of videos that hit it (e.g. "4/10"), why it works for this audience, and one concrete title example.

2B. **Brand Voice** sub-section: 4-6 voice traits (e.g. "Conversational", "Self-deprecating", "Authority-flexing") — each with a one-line definition and a verbatim quoted phrase from the analyzed transcripts as proof.

**Section 3: Cover / Thumbnail Playbook**
- Open with one line stating the evidence base: which posts carry a "Cover (vision)" read and which do not.
- Visual pattern TABLE (composition, color, faces, text overlays, props) — built ONLY from the "Cover (vision)" lines. One row per element, three columns, every cell filled:
  \`元素 | 出现于 | 例外与差异\`
  · 元素: one element only — never two bundled to make a pattern look stronger.
  · 出现于: every post whose read carries it, each written in full 帖子N（视频）/帖子N（图文） form. Copy the element exactly as that read words it.
  · 例外与差异: every post with a cover read whose read does NOT carry this element, or carries a different version of it, plus what the difference is. Write 无 only if you checked all of them and there is genuinely no exception. A read that says yellow TEXT is an exception to a yellow BLOCK row — it belongs in this cell, not in 出现于. A hedged element (看不清/疑似) is not established: leave it out of 出现于.
  Never state a fraction anywhere in this table.
- Diagnostic table: one row per post THAT HAS a "Cover (vision)" read: \`<the post's actual title> — Cover element X works because Y\`, where X and Y both come from that post's own read. Start each row with that post's real title copied from the data above — never the literal word "Title" or a generic label — and label the row with its 帖子N（视频）/帖子N（图文）. Then name the posts with no cover read and say their covers were not analysed. Never write a "works because" row for a post with no read.
- Title-line patterns that pair with the visual style. Cover copy quoted here comes from a "Cover (vision)" line character-for-character, never from a post title.

**Section 4: Hook Playbook**
For each of the 3-5 distinct hook formulas used by the channel, write a Hook Card:
- **Name + Type**
- **Template**: with [PLACEHOLDER] variables
- **How it works (Psychology)**: 2-3 sentences on the cognitive lever
- **Examples**: quote 2-3 verbatim hook lines with their [m:ss] timestamps from analyzed videos
- **When to use**: situations where this hook fits

**Section 5: Script Structure Blueprint**
- **5.1 Beat Template** table: Beat # | Beat Name | Time Range (sec-to-sec, e.g. "0-15s" not percentages) | Purpose | Signature Move
- **5.2 Item / Demonstration Template** (if the channel uses recurring item-by-item segments): per-item internal structure — Setup phrase → Reveal → Reaction line → Transition phrase, with verbatim phrasings from analyzed videos as examples
- **5.3 Emotional Escalation Map**: chart how energy/stakes shift over the runtime with cited \`[m:ss]\` peaks

**Section 6: Storytelling Frameworks**
Break this into FOUR explicit sub-sections:
- **6.1 Primary Framework**: name + 2-3 sentence definition + one full example video walk-through citing \`[m:ss]\` beats
- **6.2 Secondary Frameworks**: 1-2 alternative shapes used when the primary doesn't fit
- **6.3 Narrative Arc Shape**: the emotional arc plotted as a sequence (e.g. "calm → tension → reveal → relief → punchline") with timestamped examples
- **6.4 Signature Moves**: 3-5 recurring narrative devices unique to this creator (catchphrases, structural tics, recurring sound-bites) with quoted examples

**Section 7: Retention Mechanics**
- **7.1 Open Loops**: 3-5 specific open-loop phrases the channel uses with \`[m:ss]\` of where opened and where closed
- **7.2 Rehook Phrases**: verbatim list of every "stay with me / here's the crazy part / wait until you see this" line found across the analyzed videos, each with \`[m:ss]\`
- **7.3 Specificity Spikes**: concrete numbers, names, dates, dollar amounts that re-grab attention, each with \`[m:ss]\`
- **7.4 Pattern Breaks**: tone shifts, B-roll cuts, recap interludes, with timestamps

**Appendix A: Pre-Writing Checklist**
Translate the SOP into a 10-15-bullet actionable checklist a writer can tick before publishing (hook chosen, opening loop set, 2-3 rehooks placed, signature move included, specificity spike per minute, CTA tone, etc.). Any bullet mentioning the cover must name the posts it is drawn from in full 帖子N（视频）/帖子N（图文） form, and must not state a cover element more strongly than Section 3 does.

**Appendix B: Optimal Video Spec**
2-column table (Element / Target) covering: ideal duration, hook duration, sponsor placement, sections count, visual-reveal cadence, anecdote count, CTA style — calibrated to the channel's top performers. Every Target must trace to the data above; write 数据不足 for any row the data cannot support rather than inventing a figure. Put no cover claims in this table — covers are Section 3's.

Format as clean markdown. Cite \`[m:ss]\` timestamps from the analyzed transcripts wherever quoting a line — do NOT invent timestamps.
${QUOTE_GROUNDING_EN}
${KEEP_QUOTE_LANG_EN}
`;
  const note = transcriptCoverageNote(args.transcriptCount, args.videoCount);
  return args.language === 'zh'
    ? `${CHINESE_WRAPPER(note + inner)}\n\n${KEEP_QUOTE_LANG_ZH}`
    : note + inner;
}

export function buildAiSopReferencePrompt(args: SopArgs): string {
  const viewsLine =
    args.totalViews && args.totalViews > 0
      ? `# Total Views: ${args.totalViews.toLocaleString('en-US')}`
      : '# Total Views: unavailable';
  const inner = `You are creating an AI-optimized reference document for an automated scriptwriting agent. Based on the analysis of "${args.channelName}", create a structured reference.

Write the ENTIRE document in English (it is read by an AI scriptwriter, not an end user). Keep verbatim quotes and example lines in their original language, but all headers, definitions, and explanations must be English.

The data below is a set of per-video pattern summaries — each distills one video's reusable techniques (hook, structure, retention, CTA, signature moves). Synthesize ACROSS them into the channel's repeated patterns.

GROUNDING (critical): Use ONLY facts, numbers, prices, product/model names, handles, quotes, and [m:ss] timestamps that appear in the Analyzed Videos Data above. Never invent specifics not in the source — omit them, generalize, or tag "[unverified]" instead. Every [m:ss] you cite must actually exist in the provided summaries; if a summary carries no timestamps, do not fabricate them — describe position approximately (early / mid / late) instead.
${QUOTE_GROUNDING_EN}

## Analyzed Videos Data
${args.videosData}

## Output schema (use these exact section headers)

# CHANNEL REFERENCE: ${args.channelName}
# Generated: ${args.date}
# Videos Analyzed: ${args.videoCount}
${viewsLine}

## CONTENT_FORMULA
A one-line equation, e.g. \`Hook → Setup → Payload(3-5) → Reframe → CTA\`. Followed by 4-6 lines: each variable with its definition.

## THEMES
List 3-6 themes; per theme one line: \`THEME_NAME | hit_ratio | one-sentence definition\`.

## THUMBNAIL_ESSENTIALS
Open with which posts carry a "Cover (vision)" read and which do not. Then a bulleted list of visual + text-overlay patterns, built only from those reads and obeying the COVER RULES in the data above — one element per bullet, each naming its posts. Then a one-line diagnostic per post THAT HAS a read; name the rest as not analysed.

## HOOK_TEMPLATES
For each hook type used by the channel:
\`\`\`
TYPE: <hook type name>
TEMPLATE: <template with [PLACEHOLDER] variables>
EXAMPLE_TITLES: <2-3 ACTUAL video titles copied verbatim from the Analyzed Videos Data above — never invent or restyle a title>
EXAMPLE_OPENING: <verbatim opening line + [m:ss] from one analyzed video>
USE_WHEN: <one-sentence trigger condition>
PSYCHOLOGY: <one-sentence cognitive lever>
\`\`\`

## SCRIPT_STRUCTURE

### BEAT_TEMPLATE
A markdown table: | Beat # | Beat Name | Position | Purpose | Required Elements | — Position is a relative phase ONLY, one of: opening / early / mid / late / closing. Do NOT append any second-range or [m:ss] to it; this is a generalized cross-video template, not a per-video citation (cite real [m:ss] only in the example sections).

### ITEM_TEMPLATE
The internal structure of one demonstration / item / segment (if the channel uses repeated items):
\`\`\`
SETUP: <verbatim phrasing pattern>
HOOK_LINE: <verbatim phrasing pattern, [m:ss] cited example>
REVEAL: <verbatim phrasing pattern>
REACTION: <verbatim phrasing pattern>
TRANSITION: <verbatim phrasing pattern>
DURATION_RANGE: <sec-to-sec range typical for one item>
\`\`\`

## STORYTELLING
### PRIMARY_FRAMEWORK
Name + 2-sentence definition.
### NARRATIVE_ARC
Sequence of emotional states with \`[m:ss]\` from an analyzed video.
### SIGNATURE_MOVES
3-5 verbatim recurring devices with \`[m:ss]\` examples.

## RETENTION_MECHANICS

### OPEN_LOOPS
List 3-5 specific phrases with \`[m:ss]\` opened/closed pairs.

### REHOOK_PHRASES
Bulleted list of verbatim rehook lines with \`[m:ss]\`.

### SPECIFICITY_PATTERNS
Types of concrete details used (numbers / names / dates) with \`[m:ss]\` examples.

### SIGNATURE_REFRAMES
Recurring meaning-shift moves with verbatim examples + \`[m:ss]\`.

## RULES
Bulleted list of writing constraints the channel respects (e.g. "Never use rhetorical 'imagine' opener", "Always close with a question").

Return ONLY the document content above. No preface. No code fences around the whole document.
`;

  return transcriptCoverageNote(args.transcriptCount, args.videoCount) + inner;
}

type HottestArgs = {
  channelName: string;
  title: string;
  views: number | null;
  durationSec: number;
  url: string;
  transcript: string;
  analysisSummary: string;
  commentsSummary?: string | null;
  language?: 'en' | 'zh';
};

export function buildHottestSopPrompt(args: HottestArgs): string {
  const viewsStr =
    args.views && args.views > 0
      ? args.views.toLocaleString('en-US')
      : 'unavailable';
  const commentsBlock = args.commentsSummary
    ? `\n\n## What viewers actually say (top comments — sorted by likes)\n${args.commentsSummary}`
    : '';

  const commentsInstruction = args.commentsSummary
    ? `

After Retention Mechanics, append a **Viewer Resonance** section: synthesize the comments above into a one-paragraph answer to "why DID this video go viral?" Cross-reference specific moments from the transcript with the themes viewers raised. Quote 1-2 comments verbatim if they directly explain a structural choice.`
    : '';

  const hasTimestamps = /\[\d+:\d{2}\]/.test(args.transcript);
  const tcRule = hasTimestamps
    ? 'Cite the [m:ss] markers present in the transcript. Every timecode MUST be valid mm:ss — seconds are 00-59, carry to the next minute (60s is 1:00, never 0:60).'
    : `This transcript has NO [m:ss] markers (audio transcribed without per-word timing). Do NOT write any [m:ss] codes — locate moments approximately instead (opening / early / mid / late, or an estimated second-range within the ${args.durationSec}s duration). Never fabricate timestamps.`;

  const inner = `You are an expert YouTube content analyst performing a deep structural breakdown of the #1 most-viewed video from "${args.channelName}".

## Video Information
- **Title:** ${args.title}
- **Views:** ${viewsStr}
- **Duration:** ${args.durationSec} seconds
- **URL:** ${args.url}

## Full Transcript
${args.transcript}

## Video Analysis Summary
${args.analysisSummary}${commentsBlock}

## Instructions

Create a time-segmented structural breakdown. Break the video into 5-8 Parts; give each Part a sec-to-sec range in its header. ${tcRule} Within each Part:
- **Core Argument**: 1-2 sentences
- **Specific Examples Used**: quote 1-2 verbatim lines from the transcript
- **How it Works (Psychology)**: 2-3 sentences on the cognitive lever
- **Hooks in this Section**: each as \`[Hook Type]: "verbatim line"\`

After the Parts, append these sections (mirror the channel-level SOP's blueprint depth, but derived from THIS video only):

**Script Structure Blueprint**
- **Beat Template** table: Beat # | Beat Name | Time Range (sec-to-sec within the ${args.durationSec}s runtime, not percentages) | Purpose | Signature Move — abstracted so a writer could reuse it for a new script
- **Item / Demonstration Template** (only if the video uses recurring item-by-item segments): per-item internal structure — Setup phrase → Reveal → Reaction line → Transition phrase, with verbatim phrasings as examples
- **Emotional Escalation Map**: how energy/stakes shift over the runtime, citing peak moments

**Storytelling Framework**
- **Primary Framework**: name + 2-3 sentence definition + how this video walks through it beat by beat
- **Narrative Arc Shape**: the emotional arc as a sequence (e.g. "calm → tension → reveal → relief → punchline") with cited examples
- **Signature Moves**: 2-4 recurring narrative devices in this video (catchphrases, structural tics, recurring sound-bites) with quoted examples

**Retention Mechanics**
- **Open Loops**: specific open-loop phrases with where opened and where closed
- **Rehook Phrases**: verbatim list of every "stay with me / here's the crazy part" line
- **Specificity Spikes**: concrete numbers, names, dates, amounts that re-grab attention
- **Pattern Breaks**: tone shifts, cuts, recap interludes${commentsInstruction}

**Grounding (HARD RULE).** Base every field ONLY on what the Full Transcript above actually contains. Quote only lines that appear verbatim in the transcript — never invent quotes, stats, prices, product features, amenities, timestamps, or CTAs. Do NOT expand a bare phrase or aphorism into a fabricated full-sentence "hook line" and present it as something the creator said; if the transcript only contains a short phrase, quote just that phrase. If the transcript is thin, short, or clearly has no real speech, keep the breakdown minimal and say so plainly — do not embellish to fill the template.

Format as clean markdown.
`;
  return args.language === 'zh' ? CHINESE_WRAPPER(inner) : inner;
}

type ImagePostArgs = {
  channelName: string;
  title: string;
  engagementScore: number | null;
  url: string;
  caption: string;
  slideCount?: number | null;
  coverDescription?: string | null;
  coverWhyItWorks?: string | null;
  coverDiagnosis?: string | null;
  coverTitleSuggestions?: string[] | null;
  coverVisionAt?: Date | string | null;
  analysisSummary: string;
  commentsSummary?: string | null;
};

// XHS/Douyin only, so the output is Chinese — no language arg to silently ignore. No audio
// and no runtime either, so the video deep-dive's time axis has nothing to bind to.
export function buildImagePostSopPrompt(args: ImagePostArgs): string {
  // Provenance gate: coverVisionAt records that an image was really read; the other two are
  // legacy signals for rows predating that column. thumbnailDescription is never a signal —
  // with no image it holds a caption-derived guess, so relaying it would launder that guess.
  const hasCover = Boolean(
    args.coverVisionAt || args.coverDiagnosis || args.coverTitleSuggestions?.length,
  );
  const coverBlock = hasCover
    ? `\n\n## 封面（视觉分析结果）\n${[
        args.coverDescription ? `- 画面构成：${args.coverDescription}` : null,
        args.coverWhyItWorks ? `- 为什么抓人：${args.coverWhyItWorks}` : null,
        args.coverDiagnosis ? `- 已识别的问题：${args.coverDiagnosis}` : null,
      ]
        .filter(Boolean)
        .join('\n')}`
    : '';

  // Offering the section and telling the model to skip it loses to the structure spec every
  // time — it fills the header from the title and cites an analysis that never ran.
  const coverSection = hasCover
    ? `**封面钩子**
只使用上面「封面（视觉分析结果）」里已有的描述，不要凭标题或正文推测画面里有什么。封面在图文里承担视频"前3秒"的角色：它决定用户在信息流里停不停。写清楚它靠什么让人停手，以及哪里还能更强。

`
    : '';

  const coverBan = hasCover
    ? ''
    : '\n\n**封面（硬规则）。** 这条笔记没有做过封面视觉分析，你看不到任何图。全文禁止出现关于封面画面的任何描述或判断（构图、配色、字号、人物、材质、场景、排版一律不准写），也不准写"视觉分析里提到""画面里可能是"这类措辞。不要写封面小节。';

  const engagementStr =
    args.engagementScore && args.engagementScore > 0
      ? `${args.engagementScore.toLocaleString('en-US')}（互动分：点赞+收藏+评论+分享的加权值，不是观看数据）`
      : '不可用';

  const slideLine = args.slideCount && args.slideCount > 0 ? `\n- **图片数：** ${args.slideCount} 张` : '';

  const commentsBlock = args.commentsSummary
    ? `\n\n## 读者怎么说（热门评论，按点赞排序）\n${args.commentsSummary}`
    : '';
  const commentsInstruction = args.commentsSummary
    ? '\n\n在「可复用模板」之前插入一节 **读者共鸣**：把上面的评论归纳成一段话，回答"这篇为什么能爆"。把评论里反复出现的点和正文的具体写法对应起来；如果某条评论直接解释了某个结构选择，逐字引用 1-2 条。'
    : '';

  const inner = `你在拆解「${args.channelName}」的一篇小红书/抖音**图文帖**，产出一份可以照着复写的实战手册。

## 这条内容
- **标题：** ${args.title}
- **互动量：** ${engagementStr}${slideLine}
- **链接：** ${args.url}

## 正文全文
${args.caption}${coverBlock}

## 已有的结构化分析
${args.analysisSummary}${commentsBlock}

## 输出结构

**图文没有时间轴，也没有语音。**全文禁止出现 \`[m:ss]\` 时间码、"第几秒"、"完播率"、"观看时长"、"播放量"、"黄金前3秒"这类视频指标——它们在图文上不存在。**这一条覆盖开头术语表**：术语表里的「黄金前 3 秒钩子」「完播率痛点」是给视频用的，在图文里一律改写成「在信息流里让人停手」「愿不愿意往下滑完」。定位一律用**阅读顺序**：标题 / 开头 / 第2段 / 中段 / 结尾，或第几张图。

按下面的顺序写：

${coverSection}**标题公式**
- 逐字抄下标题原文
- 拆出它的句式骨架，把可替换的部分写成占位符（例如「[节日/事件]，当然要自己[动手做]一[核心物品]」）
- 说明这个句式踩中了什么心理（身份认同 / 好奇缺口 / 利益承诺 / 反差）
- 给出 2-3 个用同一骨架换题材的新标题

**正文结构逐段拆**
把正文按语义切成 4-7 段，每段写：
- **段落作用**：一句话
- **原文**：逐字引用该段最关键的 1-2 句（只引用正文里真实出现的句子）
- **底层心理**：2-3 句，说明这句为什么让人往下读
- **本段钩子**：\`[钩子类型]："逐字原句"\`

**情绪递进线**
用一个序列描述情绪走向（例如"共识 → 私密 → 反差 → 共鸣 → 释放"），每一步标出对应的原句。

**收尾与互动设计**
结尾怎么收的、有没有显性 CTA、留白留在哪里、为什么会让人想评论。没有 CTA 就直说没有，并指出它靠什么替代。

**可复用模板**
这一节是整份文档的落点，必须能直接照着写下一篇：
- **骨架表**：段位 | 段落名 | 作用 | 招式（把上面拆出的结构抽象成可复用的槽位，不要再复述本篇内容）
- **句式库**：从本篇里提炼 3-5 个可以换题材直接套用的句式，每个配一句原文出处
- **换题材演示**：挑一个和本篇不同的题材，用这套骨架写出标题 + 开头 2 句${commentsInstruction}

**接地（硬规则）。** 所有引用必须逐字出自上面的「标题」「正文全文」，其余一律不加引号。不准发明句子、数字、价格、品牌、活动信息或 CTA。不准把一个短语扩写成完整句子再当作原文引用——原文只有短语就只引短语。如果正文很短（图文常见），就把手册写薄一点并直说内容有限，绝不为了填满结构而编。${coverBan}

输出干净的 markdown，不要前言，不要把整篇包在代码块里。
`;

  return CHINESE_WRAPPER(inner);
}
