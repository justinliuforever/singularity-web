// Fault-injection for the Douyin post-list retry/partial-page behaviour. Stubs global fetch —
// makes no network calls. Run: pnpm --filter @goooose/db exec tsx scripts/douyin-flap-probe.ts
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

import { getDouyinUserVideos } from "@goooose/integrations/clients/douyin";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env.local") });
process.env.TIKHUB_API_KEY ??= "probe-key";

const SEC = "MS4wLjABAAAA" + "x".repeat(50);
const realFetch = globalThis.fetch;

function aweme(i: number) {
  return { aweme_id: String(1000 + i), desc: `probe ${i}`, create_time: 1750000000 + i, statistics: {} };
}
function ok(count: number, hasMore: number, cursor: number) {
  return new Response(
    JSON.stringify({ code: 200, data: { aweme_list: Array.from({ length: count }, (_, i) => aweme(i)), has_more: hasMore, max_cursor: cursor } }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}
const bad400 = () =>
  new Response(JSON.stringify({ detail: { code: 400, message: "Request failed. Please retry." } }), { status: 400 });

let calls = 0;
const fails: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) fails.push(name);
}

// Case 1: page 0 succeeds with has_more, every later page 400s.
console.log("\n=== case 1: page 1 fails, page 0 survives ===");
calls = 0;
globalThis.fetch = (async (url: string | URL | Request) => {
  calls++;
  return String(url).includes("max_cursor=0") ? ok(20, 1, 1) : bad400();
}) as typeof fetch;
const t1 = Date.now();
const r1 = await getDouyinUserVideos(SEC, 40);
const e1 = Date.now() - t1;
check("returns the 20 videos page 0 delivered", r1.videos.length === 20, `got ${r1.videos.length}`);
check("flags partial", r1.partial === true);
check("page 1 burned exactly the default 4-attempt budget", calls === 5, `${calls} fetch calls`);
console.log(`  (elapsed ${(e1 / 1000).toFixed(1)}s)`);

// Case 2: every page 400s — page 0 gets the wider budget and the caller gets the raw upstream text.
console.log("\n=== case 2: page 0 always fails ===");
calls = 0;
globalThis.fetch = (async () => {
  calls++;
  return bad400();
}) as typeof fetch;
const t2 = Date.now();
let threw: Error | null = null;
await getDouyinUserVideos(SEC, 40).catch((e: Error) => (threw = e));
const e2 = Date.now() - t2;
const msg2 = threw ? (threw as Error).message : "";
check("throws when nothing was fetched", threw !== null);
check("page 0 used the 6-attempt budget", calls === 6, `${calls} fetch calls`);
check("keeps the upstream text", msg2.includes("HTTP 400"), msg2.slice(0, 70));
check("stays inside the 60s retry budget + one attempt", e2 < 95_000, `${(e2 / 1000).toFixed(1)}s`);
console.log(`  (elapsed ${(e2 / 1000).toFixed(1)}s)`);

// Case 3: a deterministic business error must skip the budget entirely.
console.log("\n=== case 3: business error (dead/private account) ===");
calls = 0;
globalThis.fetch = (async () => {
  calls++;
  return new Response(
    JSON.stringify({ code: 200, data: { status_code: 2096, status_msg: "user not exist" } }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}) as typeof fetch;
const t3 = Date.now();
let threw3: Error | null = null;
await getDouyinUserVideos(SEC, 40).catch((e: Error) => (threw3 = e));
const e3 = Date.now() - t3;
check("throws", threw3 !== null);
check("no retries — one call only", calls === 1, `${calls} fetch calls`);
check("returns immediately", e3 < 1_000, `${e3}ms`);

globalThis.fetch = realFetch;
console.log(`\n${fails.length === 0 ? "ALL PASS" : `${fails.length} FAILED: ${fails.join(", ")}`}`);
process.exit(fails.length === 0 ? 0 : 1);
