// Scores the generated pairs on the objective axes the product already enforces: the repo's own
// countWords against the 0.9x-1.2x gate, and marker order. Subjective quality is judged blind
// elsewhere — this only measures what the code itself would accept or reject.
import { readFileSync } from "node:fs";
import { countWords } from "@goooose/domain/schemas/poet";

const TARGET = 700;
const MIN = Math.round(TARGET * 0.9);
const MAX = Math.round(TARGET * 1.2);
const ORDER = ["HOOK", "TEASE", "ITEM 1", "CLIMAX", "CTA", "CLOSE"];

type Draft = { id: number; tier: string; text: string; sec: number; tokens: number };
const drafts: Draft[] = JSON.parse(readFileSync("/tmp/writing_ab.json", "utf8"));

console.log(`target ${TARGET} 字, accepted window ${MIN}-${MAX}\n`);
const rows = drafts.map((d) => {
  const words = countWords(d.text, "zh");
  const found = (d.text.match(/\[([A-Z][A-Z0-9 ]*)\]/g) ?? []).map((m) => m.slice(1, -1));
  const inOrder = JSON.stringify(found) === JSON.stringify(ORDER);
  const inWindow = words >= MIN && words <= MAX;
  console.log(
    `  pair${d.id} ${d.tier.padEnd(5)} ${String(words).padStart(5)}字 ${inWindow ? "IN " : "OUT"}  order=${inOrder ? "OK  " : "BAD "}  ${String(d.sec).padStart(3)}s  ${d.tokens} tokens`,
  );
  return { ...d, words, inWindow, inOrder };
});

console.log();
for (const tier of ["pro", "flash"]) {
  const t = rows.filter((r) => r.tier === tier);
  const avgW = Math.round(t.reduce((s, r) => s + r.words, 0) / t.length);
  console.log(
    `  ${tier.padEnd(5)} in-window ${t.filter((r) => r.inWindow).length}/${t.length}  order-ok ${t.filter((r) => r.inOrder).length}/${t.length}  ` +
      `avg ${avgW}字 (${(avgW / TARGET).toFixed(2)}x target)  avg ${Math.round(t.reduce((s, r) => s + r.sec, 0) / t.length)}s  avg ${Math.round(t.reduce((s, r) => s + r.tokens, 0) / t.length)} tokens`,
  );
}
