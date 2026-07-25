/**
 * Smoke test for the bible file-import pipeline (stage-1 transcription + stage-2
 * anchored bible + digit audit + section selection).
 * Run: pnpm --filter @goooose/db bible-import-smoke -- <file.pdf|.docx|.md> [checklist]
 * Sample files stay local (colleague business docs) — pass absolute paths, never commit.
 */
import { readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env.local") });

const { transcribeDocument, SUPPORTED_MIMES } = await import(
  "@goooose/integrations/clients/docTranscribe"
);
const { generateBibleFromDocument } = await import(
  "@goooose/domain/services/poet/import-bible"
);
const { selectBibleSections, extractHostLine, extractTopicLine } = await import(
  "@goooose/domain/services/poet/bible"
);

const file = process.argv[2];
if (!file) {
  console.error("usage: bible-import-smoke <file> [comma-separated checklist terms]");
  process.exit(1);
}
const checklist = (process.argv[3] ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const EXT_MIME: Record<string, string> = {
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
const mime = EXT_MIME[extname(file).toLowerCase()];
if (!mime || !SUPPORTED_MIMES[mime]) {
  console.error(`unsupported extension: ${file}`);
  process.exit(1);
}

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, extra?: string) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? ` — ${extra}` : ""}`);
  ok ? pass++ : fail++;
}

const bytes = new Uint8Array(readFileSync(file));
console.log(`\n== stage 1: transcribe ${file} (${bytes.length} bytes, ${mime}) ==`);
const t0 = Date.now();
const stage1 = await transcribeDocument({
  bytes,
  mime,
  onProgress: (p) => console.log(`  [${p.phase}] ${p.detail} (${p.current}/${p.total})`),
  logger: console,
});
console.log(
  `transcript: ${stage1.transcript.length} chars, pages=${stage1.pagesTotal}, images=${stage1.imagesTotal}, flags=${stage1.flags.length}, ${((Date.now() - t0) / 1000).toFixed(1)}s`,
);
for (const f of stage1.flags) console.log(`  flag[${f.type}] ${f.detail}`);

check("transcript non-trivial", stage1.transcript.length >= 200);
for (const term of checklist) {
  check(`transcript contains 「${term}」`, stage1.transcript.includes(term));
}

console.log(`\n== stage 2: generate anchored bible ==`);
const t1 = Date.now();
const bible = await generateBibleFromDocument({
  transcript: stage1.transcript,
  channelName: "smoke-test",
  language: "zh",
  logger: console,
});
console.log(
  `bible: ${bible.content.length} chars, host=${bible.hostName ?? "-"}, drift=${bible.driftWarning?.reason ?? "none"}, flags=${bible.flags.length}, ${((Date.now() - t1) / 1000).toFixed(1)}s`,
);
for (const f of bible.flags) console.log(`  flag[${f.type}] ${f.detail}`);

check("TOPIC line present", extractTopicLine(bible.content).length > 0);
check("anchors present", /^## POSITIONING/m.test(bible.content) && /^## FACT_SHEET/m.test(bible.content));
check("length within ceiling", bible.content.length <= 9000, `${bible.content.length} chars`);
const digits = (s: string) => new Set(s.match(/\d+(?:\.\d+)?/g) ?? []);
const tDigits = digits(stage1.transcript);
const violations = [...digits(bible.content)].filter((n) => !tDigits.has(n));
check("digit audit clean (or flagged)", violations.length === 0 || bible.flags.some((f) => f.type === "audit" || f.type === "audit_source"), violations.join(","));
check("no drift", bible.driftWarning === null, bible.driftWarning?.reason);

console.log(`\n== section selection ==`);
const scriptSlice = selectBibleSections(bible.content, ["POSITIONING", "PERSONA", "CONTENT_RULES", "METHODOLOGY"]);
const museSlice = selectBibleSections(bible.content, ["POSITIONING", "AUDIENCE", "CONTENT_RULES"]);
check("script slice smaller than whole", scriptSlice.length < bible.content.length, `${scriptSlice.length}/${bible.content.length}`);
check("muse slice compact", museSlice.length < scriptSlice.length, `${museSlice.length}`);
check("legacy fallback (no anchors → whole)", selectBibleSections("TOPIC: x\n## 1. CHANNEL DESCRIPTION\nfoo", ["PERSONA"]) === "TOPIC: x\n## 1. CHANNEL DESCRIPTION\nfoo");
check("host extract consistent", extractHostLine(bible.content) === bible.hostName);

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} pass / ${fail} fail`);
console.log("\n--- bible head (first 1200 chars) ---\n" + bible.content.slice(0, 1200));
process.exit(fail === 0 ? 0 : 1);
