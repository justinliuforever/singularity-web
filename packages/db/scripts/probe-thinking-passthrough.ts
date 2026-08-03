// Can the AI SDK pass DeepSeek's thinking switch through? If yes, one change in llm.ts fixes
// every flash path; if not, the provider needs a custom fetch.
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import dotenv from "dotenv";
import { generateText } from "ai";
import { llm } from "@goooose/integrations/clients/llm";

dotenv.config({ path: resolve(import.meta.dirname, "../../../.env.local") });
const prompt = readFileSync("/tmp/heavy_prompt.txt", "utf8");

async function attempt(label: string, providerOptions?: Record<string, unknown>) {
  const t0 = Date.now();
  try {
    const r = await generateText({
      model: llm("flash"), prompt, maxOutputTokens: 16384, temperature: 0.3, maxRetries: 0,
      ...(providerOptions ? { providerOptions } : {}),
    } as Parameters<typeof generateText>[0]);
    const u = r.usage as unknown as Record<string, number | undefined>;
    const text = (r.text ?? "").trim();
    console.log(`  ${label.padEnd(34)} ${String(Math.round((Date.now()-t0)/1000)).padStart(3)}s out=${String(u?.outputTokens).padStart(5)} reasoning=${String(u?.reasoningTokens ?? 0).padStart(5)} text=${String(text.length).padStart(5)}ch ${r.finishReason}`);
  } catch (err) {
    console.log(`  ${label.padEnd(34)} ERR ${(err as Error).message.slice(0, 90)}`);
  }
}

console.log(`prompt ${prompt.length}ch\n`);
await attempt("baseline (no options)");
await attempt("providerOptions.deepseek.thinking", { deepseek: { thinking: { type: "disabled" } } });
