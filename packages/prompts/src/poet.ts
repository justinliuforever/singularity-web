import { CHINESE_WRAPPER, ZH_STYLE_GUIDE } from "./clerk";

// Instructions stay English (better structure adherence); zh output only gets the glossary appended.
function withZhStyle(prompt: string, language: "en" | "zh"): string {
  return language === "zh" ? `${prompt}\n\n${ZH_STYLE_GUIDE}` : prompt;
}

type ChannelBibleArgs = {
  ideaText: string;
  channelDescription: string;
  language?: "en" | "zh";
};

export function buildChannelBiblePrompt(args: ChannelBibleArgs): string {
  const inner = `You are a content strategist producing a Channel Bible — a strategic brief for a specific social-media channel.

## Step 0: Topic Extraction
Read the Channel Idea and Channel Description below carefully. In one short sentence (max ~12 words), identify the channel's actual subject matter — the concrete niche the user described. Examples of well-formed topic sentences:
- "Leica cameras and photography gear for collectors and serious hobbyists"
- "Italian regional home cooking with a focus on Sicily"
- "Stoic philosophy applied to startup founders"
- "Park-walking and slow-life vlogs for office workers in Beijing"

Use this exact subject as the SUBJECT throughout your entire output. Echo it back in every section heading (e.g. \`## 1. CHANNEL DESCRIPTION — <topic>\`).

**ABSOLUTE RULE — do not substitute the topic.** Do NOT extend, pivot, or "bend" the channel into a different subject. Specifically, do NOT default to AI, LLMs, ChatGPT, productivity tools, tech startups, or any topic the user did not name. If the user describes a camera channel, the Bible is about cameras — not "AI for photographers". If the user describes a cooking channel, the Bible is about cooking — not "AI recipe generators". Stay strictly inside the niche the user actually wrote.

## Inputs

**Channel Idea:** ${args.ideaText}

**Channel Description:** ${args.channelDescription}

## Output Format

Begin your response with a single machine-parseable line:
\`\`\`
TOPIC: <the one-sentence topic from Step 0>
\`\`\`
If (and ONLY if) the Channel Idea explicitly names the host person, add a second line \`HOST: <that name>\`. Never invent a host name.

Then produce these sections, each starting with its exact anchor heading (downstream systems select sections by these anchors). If the inputs give no material for a section, write a single line （暂无，可后续补充） under it — do not pad or invent.

## POSITIONING — <topic>
- What the channel is about (core topic, tone, format), what makes it distinct in its niche
- Specific products, brands, sub-topics, or recurring concepts this channel covers (name them — e.g. for a Leica channel, name actual lens models / camera bodies / film stocks)

## PERSONA — <topic>
- Host identity as the user described it: role, credentials, backstory — ONLY what the Channel Idea/Description states about THIS account's host

## AUDIENCE — <topic>
- The typical viewer, their needs, and why they watch

## CONTENT_PILLARS — <topic>
- 3-5 recurring content pillars/formats

## CONTENT_RULES — <topic>
- Tone, do/don'ts, on-brand vs off-brand rules the inputs support

## METHODOLOGY — <topic>
- Named methods/systems/frameworks the host uses, with their concrete specifics — ONLY if stated in the inputs

## INFORMATION_SOURCES — <topic>
- Primary research sources for THIS specific topic (name actual sites, communities, publications, or marketplaces — not generic platforms)
- How to find fresh topics consistently; signals of high-performing ideas in this niche

## TOPIC_FRAMEWORK — <topic>
- The structural pattern to follow when generating an idea; what makes a topic on-brand vs off-brand
- 3 concrete sample topics this channel could publish next week, each specific to the niche named in Step 0

## FACT_SHEET — <topic>
- Bullet list of verbatim atomic facts from the inputs worth citing in scripts (numbers/names exactly as given). Omit entirely if the inputs contain none — never fabricate.

## OUTPUT RULES
- No fluff. No hype. No motivational language.
- Write like a strategist briefing a content team.
- Short sentences. Direct statements.
- Every section must be immediately actionable.
- Stay grounded in the topic extracted in Step 0. If you find yourself reaching for AI, tech, or productivity examples to fill a section, stop and pull from the user's actual niche instead.
`;
  if (args.language !== "zh") return inner;
  return (
    CHINESE_WRAPPER(inner) +
    "\n\nIMPORTANT: 第一行的 TOPIC: 标记（以及可选的 HOST: 行）必须保留英文前缀，后面跟简体中文内容。章节锚点保留英文（## POSITIONING / ## PERSONA / ## AUDIENCE / ## CONTENT_PILLARS / ## CONTENT_RULES / ## METHODOLOGY / ## INFORMATION_SOURCES / ## TOPIC_FRAMEWORK / ## FACT_SHEET），描述内容全部使用简体中文。"
  );
}

type BibleFromDocumentArgs = {
  transcript: string;
  channelName?: string;
  language?: "en" | "zh";
};

// Import mode: the source is the creator's OWN persona/IP document, so fidelity beats
// invention — every specific must come from the transcript.
export function buildBibleFromDocumentPrompt(args: BibleFromDocumentArgs): string {
  const zh = (args.language ?? "zh") === "zh";
  return `You are a content strategist. Below is a FAITHFUL TRANSCRIPT of a creator's own persona/IP document (人设文档). Restructure it into a Channel Bible — a strategic brief that will condition all AI content generation for this creator's account${args.channelName ? ` ("${args.channelName}")` : ""}.

## ABSOLUTE RULES
- Every number, name, coordinate, dosage, and proper noun you include MUST be copied verbatim from the transcript. Invent NOTHING that is not in the transcript.
- This document describes THIS account's own host. Their name, credentials, and methodology are the account's identity.
- Total length ≤ 7000 ${zh ? "Chinese characters" : "words"}. You need NOT reproduce every table cell — the full transcript is preserved separately as a grounding source. Prioritize: identity, methodology names + their concrete specifics, content rules, audience.
- ${zh ? "Body in 简体中文." : "Body in English."} Keep the machine-parseable lines and section anchors in English exactly as specified.
- If the transcript contains ${"`[无法辨识]`"} marks or visibly truncated table rows, do not guess the missing values — skip them.

## OUTPUT FORMAT (exact)
First line:  TOPIC: <one-sentence topic of this channel>
Second line: HOST: <the host's personal name as stated in the document, or omit this line if none>

Then these sections, each starting with the exact anchor line:
## POSITIONING
(what this channel/IP is, its core thesis and differentiation)
## PERSONA
(host identity, credentials, titles, signature methods — as stated about THIS account's host)
## AUDIENCE
(who this content serves, their needs — derive only from the document)
## CONTENT_PILLARS
(3-5 recurring content pillars grounded in the document's methodology/topics)
## CONTENT_RULES
(dos/don'ts, tone, taboos, ratios — only what the document supports)
## METHODOLOGY
(the named systems with their concrete specifics: lists, coordinates, dosages, sequences — verbatim key facts)
## INFORMATION_SOURCES
(where this creator's content material comes from per the document; if the document is silent, derive conservatively from the niche)
## TOPIC_FRAMEWORK
(how to generate on-brand topics from the methodology/pillars; 3 concrete sample topics grounded in the document)
## FACT_SHEET
(bullet list of verbatim atomic facts worth citing in scripts: "- <fact>". Numbers/names exactly as in transcript)

## TRANSCRIPT
${args.transcript}`;
}

type ScriptWritingArgs = {
  channelBible: string;
  sopReference: string;
  referencesContext: string;
  verbatimFactsContext: string;
  sourceTitle: string;
  sourceChannel: string;
  viralTrigger: string;
  ideaText: string;
  language: "en" | "zh";
  targetWordCount: number;
  channelName?: string;
  hostName?: string | null;
};

// Bible/SOP can carry the ANALYZED creator's self-references ("我是孟娇"), so a self-name is
// allowed only when it is the account's own name or the Bible-declared host.
export function identityRule(channelName: string | undefined, hostName?: string | null): string {
  const host = hostName?.trim() || undefined;
  const forChannel = channelName ? ` You are writing for the account "${channelName}".` : "";
  const allowed = [channelName, host].filter(Boolean).map((n) => `"${n}"`).join(" or ");
  const nameGate = allowed
    ? `The ONLY name(s) the host may use for themselves: ${allowed}.${host ? ` The Channel Bible declares this account's host is "${host}" — PREFER that name for self-introductions and sign-offs (e.g. 我是${host}); the account name is a handle, not necessarily the person.` : ""} If the Bible or SOP mentions a different personal name (e.g. "我是孟娇"), that is the ANALYZED creator, not this account's host — never use that name, and omit name-based self-introductions and sign-offs entirely.`
    : `Do not use ANY personal name for the host — no "我是XX" / "I'm XX" self-introductions or named sign-offs.`;
  return `**Speaker identity (HARD RULE).**${forChannel} The SOP below is a STRUCTURAL voice model distilled from analyzed videos: imitate its structure, rhythm, hook patterns, and retention devices — never the source creator's identity. ${nameGate} Do not claim the analyzed creator's credentials or backstory (e.g. "做了20年医美") as the host's own unless the Channel Bible explicitly states it about THIS account. When identity is uncertain, write host-neutral first person with no name and no invented personal history.`;
}

export function buildScriptWritingPrompt(args: ScriptWritingArgs): string {
  const languageName = args.language === "zh" ? "Chinese (中文)" : "English";
  const lengthUnit = args.language === "zh" ? "characters (字)" : "words";
  const minWordCount = Math.round(args.targetWordCount * 0.9);
  const maxWordCount = Math.round(args.targetWordCount * 1.2);
  const isShort = args.targetWordCount < 300;
  // A sub-90s script can't carry six beats inside its word budget; forcing every marker is
  // the biggest driver of short-form overshoot.
  const markerLine = isShort
    ? "Output the script as plain text with ONLY these markers, in order: [HOOK], [ITEM 1], [CTA]. One or two short sentences each. Omit [TEASE], [CLIMAX], and [CLOSE] — a short video has no room for them."
    : "Output the script as plain text, with section markers in this EXACT order: [HOOK], [TEASE], [ITEM 1], [CLIMAX], [CTA], [CLOSE]. Use each marker once; [CLIMAX] must come before [CTA]; [CLOSE] is the single final sign-off.";

  return withZhStyle(`You are a scriptwriter for a specific niche channel. Your job is to write a complete, ready-to-film script that sounds like a real human host speaking — not a polished AI document.

## Step 1: Channel Bible
Understand the niche, the core thesis, the content rules, and the source categories.

${args.channelBible}

## Step 2: SOP Reference (Voice, Structure & Retention Mechanics)
This SOP was generated from analysis of top-performing videos. It defines voice, tone, hook formulas, beat-by-beat structure, and retention devices. This is your primary guide for HOW to write — structure and rhythm, not identity.

${identityRule(args.channelName, args.hostName)}

${args.sopReference}

## Step 3: Research References
These are source materials — competitor videos, transcripts, and notes — that contain the facts, framing, and angles for this topic. Use them as research, not as a voice to copy. Extract what's relevant; write it in the channel's own voice as defined by the SOP above.

${args.referencesContext}

## Step 4: Verbatim Facts
These specific data points must appear in the script exactly as written — do not paraphrase numbers, names, or specs.

${args.verbatimFactsContext}

## The Idea to Script
- **Source Video Title:** ${args.sourceTitle}
- **Source Channel:** ${args.sourceChannel}
- **Viral Trigger (why the original worked):** ${args.viralTrigger}
- **Idea:**
${args.ideaText}

## Step 5: Write the Script

Write a COMPLETE, ready-to-film script in **${languageName}**. Length is a HARD WINDOW: **${minWordCount}–${maxWordCount} ${lengthUnit}** (aim for ~${args.targetWordCount}). Do not fall below ${minWordCount} and do NOT exceed ${maxWordCount}.${isShort ? " This is a SHORT video — keep every section to 1-2 sentences, front-load the hook, and cut anything that doesn't earn its place. Do not pad to reach a higher count." : ` If you finish all sections early, expand the ITEM sections with more specific detail until you reach ~${args.targetWordCount} — then STOP. Never pad with filler, and do not exceed ${maxWordCount}.`}
If the Idea or References carry their own pacing — per-second beat notes like 「开场（0-20秒）」, a draft script written for a different length, or an implied shorter/longer video — IGNORE that pacing entirely. The window above is the only length target; re-proportion the material to fill it.

Follow the SOP structure precisely:
1. Open with one of the hook formulas from the SOP, adapted to this topic.
2. Follow the exact beat-by-beat template from the SOP.
3. Use the retention devices from the SOP: open loops, rehook phrases, specificity spikes, emotional reframes.
4. Place the CTA AFTER the climax — the climax is the emotional peak, the CTA is the viewer's next-step ask.
5. Build emotional escalation toward the [CLIMAX] (the most powerful beat); keep [CLOSE] a brief single sign-off — not a second climax or a second CTA.
6. Write in the voice and tone described in the SOP — as if a real person is speaking, not reading a document.
7. If the Channel Bible defines a recurring brand wrapper, signature phrase, or show-name segment (e.g. "The Code Report", "Welcome back to X"), include it naturally in the script.

**Sensitive topic guard.** If the topic genuinely touches dangerous territory (weapons, malware, illicit drugs, self-harm, etc.), stay responsible — don't write an actionable how-to or step-by-step blueprint. For everything else, write naturally and specifically; do not become vague, evasive, or euphemistic about ordinary topics.

**Sound like a human talking, not an AI writing.** The SOP describes a real host's voice. Honour it:
- Use the sentence lengths and rhythms the SOP shows, not generic YouTube-presenter cadences.
- Vary sentence length — short punchy statements, then longer ones that breathe. Avoid uniform sentence structure.
- Transitions should sound like the host thinks of them mid-sentence ("here's the thing", "but wait") — not like document transitions ("furthermore", "in conclusion").
- Emotion goes on the surface, not buried in subtext. If something is surprising, say it like it's surprising.
- Never start a paragraph with "In today's video" or close with "If you found this helpful".

**Facts from references:**
- Copy every number, date, name, price, and model name exactly as it appears in the references. Do not round, normalise, or convert.
- Do not invent any fact not present in the references. If a fact isn't there, leave it out.
- Preserve uncertainty. If a source fact is hedged (待核实 / 需验证 / 大约 / 可能 / estimated / reportedly / "a large share"), keep it hedged or generalize it — never upgrade a tentative claim into a definitive number, year, or absolute ("多数都是" / "亏了两万"). A flagged ⚠️ DISPUTED fact must be generalized or omitted, never stated as a hard value.

${markerLine} No meta-commentary, no preamble.
`, args.language);
}

type OutlineArgs = {
  sopReference: string;
  referencesContext: string;
  ideaText: string;
  viralTrigger: string;
  targetWordCount: number;
  language: "en" | "zh";
};

export function buildLongFormOutlinePrompt(args: OutlineArgs): string {
  const lengthUnit = args.language === "zh" ? "characters (字)" : "words";
  const rate = args.language === "zh" ? 200 : 150;
  const durationApprox = Math.round(args.targetWordCount / rate);
  return `You are planning a long-form YouTube script for a specific niche channel.

## SOP Reference (voice, structure, retention mechanics — follow this precisely)
${args.sopReference}

## References (research material — pull concrete facts from here)
${args.referencesContext}

## The Idea
${args.ideaText}

## Viral Trigger
${args.viralTrigger}

## Task: Generate a Beat-by-Beat Outline

The final script targets approximately ${args.targetWordCount} ${lengthUnit} (~${durationApprox} minutes of speech).

Produce a JSON object with this exact structure:
{
  "overall_arc": "One sentence: the emotional journey from hook to climax.",
  "sections": [
    {
      "marker": "[HOOK]",
      "key_points": ["specific fact or story beat from the references", "another specific beat"],
      "target_count": 400,
      "emotional_note": "the tone and energy level of this section"
    }
  ]
}

Rules:
- Use ONLY these markers in this order: [HOOK], [TEASE], [ITEM 1], [ITEM 2], ... (as many ITEMs as the SOP demands), [CLIMAX], [CTA], [CLOSE]. [CLIMAX] is the emotional peak and MUST come before [CTA]; [CTA] is the viewer's next-step ask; [CLOSE] is the single brief final sign-off.
- key_points must be CONCRETE — pull real facts, names, numbers from the References. No generic placeholders.
- target_count values must sum to approximately ${args.targetWordCount}
- Suggested budget: HOOK 8%, TEASE 5%, CLIMAX 18%, CTA 3%, CLOSE 6%; divide the remaining 60% equally across ITEM sections
- emotional_note: be specific (e.g. "calm and factual, building curiosity", "sharp revelation, audience feels cheated", "triumphant payoff")

Output ONLY the JSON. No markdown fences, no explanation.
`;
}

type SectionExpandArgs = {
  language: "en" | "zh";
  sopReference: string;
  referencesContext: string;
  verbatimFactsContext: string;
  overallArc: string;
  outlineSummary: string;
  prevTail: string;
  marker: string;
  keyPoints: string;
  targetCount: number;
  emotionalNote: string;
  channelName?: string;
  hostName?: string | null;
};

export function buildSectionExpandPrompt(args: SectionExpandArgs): string {
  const languageName = args.language === "zh" ? "Chinese (中文)" : "English";
  const lengthUnit = args.language === "zh" ? "characters (字)" : "words";
  const minCount = Math.round(args.targetCount * 0.85);
  const maxCount = Math.round(args.targetCount * 1.2);
  return withZhStyle(`You are writing one section of a long-form YouTube script in **${languageName}**.

## SOP Reference (this is your VOICE MODEL — follow the tone, rhythm, and retention devices exactly)
${identityRule(args.channelName, args.hostName)}

${args.sopReference}

## References (research material — extract facts and framing from here)
${args.referencesContext}

## Verbatim Facts (copy these character-for-character — numbers, names, prices, specs)
${args.verbatimFactsContext}
Preserve uncertainty: if a fact is hedged (待核实 / 需验证 / 大约 / 可能 / estimated) or marked ⚠️ DISPUTED, keep it hedged or generalize it — never state a tentative claim as a definitive number, year, or absolute.

## Full Script Outline (maintain consistency with the overall arc)
Overall arc: ${args.overallArc}

All sections:
${args.outlineSummary}

## Previous Section Tail (maintain narrative flow — pick up naturally from here)
${args.prevTail}

## Your Section
Marker: ${args.marker}
Key points to cover:
${args.keyPoints}
Target length: ~${args.targetCount} ${lengthUnit}
Length window: ${minCount}–${maxCount} ${lengthUnit} — stay inside this window.
Tone/energy: ${args.emotionalNote}

Write ONLY the content of this section. Do NOT include the section marker — it will be added automatically.
Do NOT start the next section. End at a natural stopping point.
Sound like a real human talking. Follow the SOP voice precisely.

**Length discipline**: Cover the key points fully. If you're below ${minCount} ${lengthUnit}, add specific examples, vivid detail, or emotional depth — never filler. But once the key points are covered and you're inside the window, STOP — do not exceed ${maxCount} ${lengthUnit} and do not pad or repeat to inflate length. A tight section that lands in-window beats a bloated one.
`, args.language);
}

type TopicAnalysisArgs = {
  channelBible: string;
  // Digit-audited FACT_SHEET of an imported bible — the one bible section usable as facts.
  verifiedFacts?: string | null;
  sopReference: string;
  topic: string;
  referencesContext: string;
  language: "en" | "zh";
};

export function buildTopicAnalysisPrompt(args: TopicAnalysisArgs): string {
  const languageName = args.language === "zh" ? "Chinese (中文)" : "English";
  const lengthUnit = args.language === "zh" ? "characters (字)" : "words";
  const verifiedBlock = args.verifiedFacts?.trim()
    ? `\n## Verified Account Facts (from this account's own persona document — a legitimate FACT source)\n${args.verifiedFacts.trim()}\n`
    : "";
  const verifiedRule = args.verifiedFacts?.trim()
    ? `\n- The Verified Account Facts above ARE usable as facts (unlike the Bible/SOP): when the topic touches the account's own methodology, copy names, classifications, numbered step ORDER, and figures from them VERBATIM. Never contradict, reverse, or reorder them, and never anonymize them into placeholders (no 某种 / 某类 / 若干 / "特定剂量" style masking — state the real term or omit it).`
    : "";
  const base = `You are an editorial strategist for a YouTube channel. Given a user-supplied topic and (optionally) reference materials, generate the structured idea fields that the scriptwriter will consume.

## Channel Bible (the brand, niche, and rules)
${args.channelBible}
${verifiedBlock}
## SOP Reference (the channel's voice and viral mechanics)
${args.sopReference}

## User Topic
${args.topic}

## External References
${args.referencesContext}

## Grounding & anti-fabrication (HARD RULES — these override the creative instructions below)
- The Channel Bible and SOP above are for VOICE and STYLE ONLY. NEVER pull facts, people, brands, events, dates, prices, quotes, or backstories from them into this topic's output. They tell you HOW to talk, not WHAT is true.${verifiedRule}
- Every factual claim (names, people, brands, dates, quotes, prices, events) in story_angle / facts_and_data / why_similar / viral_trigger MUST be supported by the External References for THIS topic. If the reference is a simple product post, keep the angle within what that post actually shows — do NOT import a different person, brand, death, or backstory from anywhere else.
- NEVER state that a named real person has died, is ill, did something wrong, or made a specific statement, unless the External References explicitly say so — not even hedged. A false claim about a real person or brand (a death, a scandal, an invented quote) is the single worst failure this tool can produce. When unsure, stay general and name no one.
- If the references are thin, produce a THINNER result (fewer facts, a more general angle). Do NOT backfill with invented specifics.

## Your Task

Output a JSON object with exactly these five keys:

- "story_angle": One paragraph (~80–150 ${lengthUnit}) describing the specific narrative angle for this topic, framed for this channel's audience. Be concrete — name the specific story you'd tell, not the general subject.

- "facts_and_data": Bullet list of concrete facts, statistics, examples, and data points the script should incorporate. **Do not artificially limit the count.** If the references contain twelve distinct camera models and forty data points, capture all of them; if they only contain three, capture three. Walk the references end-to-end and capture every concrete fact you find. **Every fact MUST come from the External References${args.verifiedFacts?.trim() ? " or the Verified Account Facts" : ""}.** If the references are thin, produce FEWER facts — do NOT backfill from the Channel Bible, general knowledge, or invention. "(needs verification)" is only for a genuinely-uncertain figure about the source's own subject, never a license to introduce a new person, death, event, price, or scandal not in the references.

- "verbatim_facts": A flat newline-separated list of the most important factual atoms pulled **VERBATIM** from the references. Each line is one atom. Format: \`- <verbatim fact> [src: <reference title>]\`. Examples:
  \`- M3 viewfinder magnification: 0.91x [src: Leica M Series Film Cameras Overview]\`
  \`- M7 produced between 2002–2018 [src: Leica M Series Film Cameras Overview]\`
  Rules for this field:
    * Numbers (years, prices, magnifications, focal lengths, shutter speeds, ISOs, percentages, dates, durations) must be copied **character-for-character** from the source. Do not round, normalize, or convert units.
    * Proper nouns (model names, person names, brand names, place names) must be copied verbatim.
    * Direct quotes must be enclosed in straight double-quotes and unchanged.
    * Walk every reference end-to-end and emit one line per discrete fact. A 12-camera overview should produce dozens of lines, not 5.
    * If a reference contributes no extractable verbatim facts, omit it from this field rather than invent.
    * **Never fabricate** a fact that isn't in the source. If you didn't see it in the references, don't include it here.

- "why_similar": One short paragraph explaining why this topic fits the channel's niche per the Bible. Reference specific Bible rules or content pillars.

- "viral_trigger": One short paragraph (~60–100 ${lengthUnit}) explaining the emotional/curiosity mechanism that would make this topic perform — what makes a viewer click and stay.

## Output

Output ONLY the JSON object. No markdown fences, no explanation, no prefix. The response must be parseable by json.loads().

\`story_angle\`, \`facts_and_data\`, \`why_similar\`, and \`viral_trigger\` must be written in **${languageName}**. \`verbatim_facts\` stays in the **original language of the references** so numbers and proper nouns are not corrupted by translation.
`;
  if (args.language !== "zh") return base;
  return (
    base +
    "\n\n【重要输出要求】story_angle、facts_and_data、why_similar、viral_trigger 字段必须用简体中文输出。verbatim_facts 保持原始语言（数字和专有名词不翻译）。仅返回有效 JSON，不使用代码块。\n【去翻译腔】字段值要像中文编导说话：不要直译生造词（禁止 认知基模 / 认知杠杆 / 模式打断 / 开放回路 / 视觉锤 之类），不要照抄 SOP 里的英文公式或英文标签（如 'Pattern Interrupt + Curiosity Gap …'）——一律用自然中文转述。"
  );
}

export type FactCheckItem = { index: number; fact: string; src: string };

// Deliberately conservative: defaults to "verified" — a false flag is worse than a miss.
export function buildFactCheckPrompt(args: {
  items: FactCheckItem[];
  referenceTitles: string[];
  language: "en" | "zh";
}): string {
  const noteLang = args.language === "zh" ? "Chinese (中文)" : "English";
  const list = args.items
    .map((it) => `${it.index}. ${it.fact}${it.src ? ` [src: ${it.src}]` : ""}`)
    .join("\n");
  const sources = args.referenceTitles.length
    ? args.referenceTitles.map((t) => `- ${t}`).join("\n")
    : "(no reference titles provided)";
  return `You are a meticulous fact-checker. Below is a numbered list of factual atoms extracted from reference material, each tagged with the source it was pulled from. A source citation does NOT guarantee the fact is correct — reference material can itself be wrong. Using your own world knowledge, classify each fact.

## Sources these facts were pulled from
${sources}

## Facts to check
${list}

## First: is this even a checkable factual claim?
Many atoms are NOT factual claims — dialogue lines, direct quotes, song lyrics, opinions, rhetorical fragments, or a bare proper noun with no assertion. These cannot be true or false, so mark them "verified" (i.e. nothing to flag). Only evaluate atoms that assert a checkable fact about the world.

## For each fact, assign one status
- "verified": consistent with well-known reality; OR not a checkable factual claim (dialogue/quote/lyric/opinion/fragment); OR you cannot judge it from world knowledge (a niche/obscure detail or unfamiliar name). DEFAULT to "verified" when unsure. Most atoms should be "verified".
- "disputed": ONLY when you are HIGHLY confident it conflicts with widely-known reality (e.g. a famous product's launch year, a well-known date / name / spec is wrong). In "note", give the commonly-accepted correct value, briefly.
- "unsupported": ONLY when the claim is internally incoherent or self-evidently impossible. Note: an unfamiliar company / person / product name is NOT grounds for this — niche or unknown entities default to "verified", never "unsupported".

## Critical rules
- Be conservative. When in doubt → "verified". Do NOT flag something merely because you're unsure or don't recognize a name — only clear, high-confidence conflicts. A wrongly-flagged correct fact is worse than a missed one.
- Never call a verbatim source quote "编造"/"fabricated" just because it sounds odd or names something you don't know — it was really said in the source.
- Do NOT rewrite or correct the facts themselves. Only classify, and for "disputed"/"unsupported" add a short "note".
- "note" must be written in ${noteLang}. Omit "note" for "verified".

## Output
Output ONLY a JSON array, one object per fact, in the same order:
[{"index": 1, "status": "verified"}, {"index": 2, "status": "disputed", "note": "..."}]
No markdown fences, no prose. Must be parseable by JSON.parse().`;
}

export function buildChineseHumanizerPrompt(scriptText: string, maxChars?: number): string {
  const lengthBlock = maxChars
    ? `\n**长度硬上限**：改写后全文不得超过 ${maxChars} 字（含标点）。口语化不等于变长——不要把一句话拆成三句，不要新增论点，不要补充原稿没有的解释。脚本是按秒计费的口播，超出上限即失败。\n`
    : "";
  return `你现在是这个视频的真实创作者，正在对着镜头说话。这个脚本是AI草稿，你的任务是把它改成你自己真实开口说出来的样子。

不是"润色"，不是"优化"——是**改写成真人说话**。

## 改写标准
${lengthBlock}
**语气**：想象你现在坐在镜头前，跟一个认识你但不是专家的朋友聊天。不是演讲，不是播报，就是聊天。

**句子**：你说话不会句句完整。短句就短句，省略就省略。真人说话会有停顿，会突然换个角度。

**口语词**：把书面词换成你嘴里真的会说的词。"然而"→"但是呢"，"因此"→"所以"，"值得注意的是"→直接说，"总体而言"→删掉。

**不要**：
- 不要用"首先、其次、最后"这种结构词——除非这个创作者真的会这样说
- 不要每段开头都是完整主谓宾句
- 不要把情绪藏在里面——激动就激动，感叹就感叹，直接说出来
- 不要为了"专业感"加任何修饰——真人不在乎专业感，在乎真实感

**必须保留**：
- 所有段落标记 [HOOK]、[TEASE]、[ITEM]、[CTA]、[CLIMAX]、[CLOSE]
- 所有数字、名字、数据、价格、型号——一个字不改
- 所有论点和数据${maxChars ? "（在长度上限内保留——靠删冗余词达标，不靠删信息）" : "——不要删减任何论点或细节"}

## 脚本

${scriptText}

## 输出

直接输出改写后的完整脚本。不加任何解释或前言。只输出脚本本身。
`;
}

export function buildScriptCompressPrompt(args: {
  scriptText: string;
  language: "zh" | "en";
  targetWordCount: number;
}): string {
  const lengthUnit = args.language === "zh" ? "characters (字)" : "words";
  const maxCount = Math.round(args.targetWordCount * 1.2);
  const minCount = Math.round(args.targetWordCount * 0.85);
  return `You are a short-video script editor. The draft below overshoots its spoken-length budget. Compress it to **${minCount}–${maxCount} ${lengthUnit}** without losing what makes it work.

Rules:
- Keep the script's original language exactly as written.
- Keep ALL section markers ([HOOK], [TEASE], [ITEM], [CLIMAX], [CTA], [CLOSE]) that survive, and always keep the [HOOK] and the [CTA].
- Every number, name, price, model, date must stay character-for-character or be removed with its sentence — never alter a value.
- Cut by: removing repetition and filler, merging wordy sentences, and — if still over budget — deleting the single least information-dense middle section entirely (a [TEASE] or one [ITEM]).
- Do not add anything new.

## Draft

${args.scriptText}

## Output

Output ONLY the compressed script, no explanation.`;
}

export function buildScriptExpandPrompt(args: {
  scriptText: string;
  language: "zh" | "en";
  targetWordCount: number;
  referencesContext: string;
}): string {
  const lengthUnit = args.language === "zh" ? "characters (字)" : "words";
  const minCount = Math.round(args.targetWordCount * 0.9);
  const maxCount = Math.round(args.targetWordCount * 1.15);
  return `You are a long-form script editor. The draft below runs SHORT of its target spoken length. Lengthen it to **${minCount}–${maxCount} ${lengthUnit}** by deepening the EXISTING sections — never pad.

How to lengthen (priority order):
- Add specific, concrete detail, examples, and explanation drawn from the References below.
- Develop the existing points further: fuller reasoning, sharper transitions, more vivid storytelling/emotion.
- Do NOT add new [SECTION] markers or new top-level sections — expand within the ones already there.
- Do NOT repeat, restate, or add filler; every added sentence must carry new information or feeling.

Rules:
- Keep the script's original language exactly.
- Keep EVERY section marker ([HOOK], [TEASE], [ITEM …], [CLIMAX], [CTA], [CLOSE]) in place, each on its own line.
- Every number, name, price, model, date already present stays character-for-character; only add facts grounded in the References — never invent specifics.

## References

${args.referencesContext}

## Draft

${args.scriptText}

## Output

Output ONLY the expanded script, no explanation.`;
}
