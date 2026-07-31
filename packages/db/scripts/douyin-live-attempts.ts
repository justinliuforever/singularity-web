// Live diagnostic: count attempts + where each one dies on the real TikHub post-list call.
// Run: pnpm --filter @goooose/db exec tsx scripts/douyin-live-attempts.ts
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

import { getDouyinUserVideos } from "@goooose/integrations/clients/douyin";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env.local") });

const SEC = process.argv[2] ?? "MS4wLjABAAAAvI8Tx_jBjJDQvYT8OhJi_gGY6wZK4vFmQzUvNiPZ3kU";
const realFetch = globalThis.fetch;
let n = 0;

globalThis.fetch = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const i = ++n;
  const t = Date.now();
  try {
    const res = await realFetch(url, init);
    const buf = await res.clone().arrayBuffer().catch((e: Error) => {
      console.log(`  attempt ${i}: HTTP ${res.status}, BODY DIED after ${Date.now() - t}ms — ${e.message}`);
      return null;
    });
    if (buf) console.log(`  attempt ${i}: HTTP ${res.status}, ${buf.byteLength} bytes in ${Date.now() - t}ms`);
    return res;
  } catch (e) {
    console.log(`  attempt ${i}: CONNECT/HEADERS DIED after ${Date.now() - t}ms — ${(e as Error).message}`);
    throw e;
  }
}) as typeof fetch;

console.log(`sec_user_id=${SEC.slice(0, 24)}…  requesting 40 (count=20 per page)`);
const t0 = Date.now();
try {
  const r = await getDouyinUserVideos(SEC, 40);
  console.log(`OK: ${r.videos.length} videos, partial=${r.partial}, ${n} fetch calls, ${Date.now() - t0}ms`);
} catch (err) {
  console.log(`THREW after ${n} fetch calls, ${Date.now() - t0}ms: ${(err as Error).message.slice(0, 160)}`);
}
globalThis.fetch = realFetch;
