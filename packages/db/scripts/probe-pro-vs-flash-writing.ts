// Flash beat Pro on structured extraction. Writing is a different job — this generates real
// short-form scripts from BOTH tiers using the shipped prompt, real SOP and real bible, and
// writes them to /tmp for blind judging. Nothing here decides quality; it only produces pairs.
// Run: pnpm --filter @goooose/db exec tsx scripts/probe-pro-vs-flash-writing.ts
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
import dotenv from "dotenv";
import { generateText } from "ai";
import { desc, eq, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { buildScriptWritingPrompt } from "@goooose/prompts/poet";
import { llm } from "@goooose/integrations/clients/llm";
import { clerkSops, poetBible } from "../src/schema";

dotenv.config({ path: resolve(import.meta.dirname, "../../../.env.local") });
const client = postgres(process.env.DATABASE_URL!, { prepare: false });
const db = drizzle(client);

const PAIRS = Number(process.env.PAIRS ?? 3);

try {
  const [sop] = await db.select().from(clerkSops).where(isNotNull(clerkSops.contentMd)).orderBy(desc(clerkSops.generatedAt)).limit(1);
  const [bible] = await db.select().from(poetBible).where(eq(poetBible.isActive, true)).limit(1);
  if (!sop?.contentMd || !bible?.content) throw new Error("need one SOP and one active bible");

  const prompt = buildScriptWritingPrompt({
    channelBible: bible.content.slice(0, 6000),
    sopReference: sop.contentMd.slice(0, 8000),
    referencesContext: "（无外部素材，仅依据圣经与 SOP 创作）",
    channelName: "搬砖小鹅",
    hostName: null,
    ideaText: "为什么大多数人看了一堆对标还是不会写稿：拆解停在了「他讲了什么」，没到「他为什么这样排」。",
    viralTrigger: "开场用一个反直觉判断打断惯性滑动",
    targetWordCount: 700,
    language: "zh",
  } as Parameters<typeof buildScriptWritingPrompt>[0]);

  console.log(`prompt ${prompt.length}ch | SOP ${sop.contentMd.length}ch | bible ${bible.content.length}ch`);
  console.log(`generating ${PAIRS} pairs\n`);

  const out: Array<{ id: number; tier: string; text: string; sec: number; tokens: number }> = [];
  for (let i = 1; i <= PAIRS; i++) {
    for (const tier of ["pro", "flash"] as const) {
      const t0 = Date.now();
      const r = await generateText({ model: llm(tier), prompt, temperature: 0.7, maxOutputTokens: 8192, maxRetries: 1 });
      const u = r.usage as unknown as Record<string, number | undefined>;
      const sec = Math.round((Date.now() - t0) / 1000);
      const text = (r.text ?? "").trim();
      out.push({ id: i, tier, text, sec, tokens: Number(u?.outputTokens ?? 0) });
      const markers = (text.match(/\[(HOOK|TEASE|ITEM 1|CLIMAX|CTA|CLOSE)\]/g) ?? []).length;
      console.log(`  pair${i} ${tier.padEnd(5)} ${String(sec).padStart(3)}s  ${String(text.length).padStart(5)}ch  markers=${markers}/6  out=${u?.outputTokens}  ${r.finishReason}`);
    }
  }

  writeFileSync("/tmp/writing_ab.json", JSON.stringify(out, null, 2));
  console.log(`\nwrote ${out.length} drafts to /tmp/writing_ab.json`);
  const avg = (t: string, f: (x: (typeof out)[number]) => number) => Math.round(out.filter((x) => x.tier === t).reduce((s, x) => s + f(x), 0) / PAIRS);
  console.log(`  pro   avg ${avg("pro", (x) => x.sec)}s  ${avg("pro", (x) => x.text.length)}ch  ${avg("pro", (x) => x.tokens)} tokens`);
  console.log(`  flash avg ${avg("flash", (x) => x.sec)}s  ${avg("flash", (x) => x.text.length)}ch  ${avg("flash", (x) => x.tokens)} tokens`);
} finally { await client.end(); }
