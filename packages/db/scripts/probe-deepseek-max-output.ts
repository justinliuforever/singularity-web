import { resolve } from "node:path";
import dotenv from "dotenv";
import { generateText } from "ai";
import { llm } from "@goooose/integrations/clients/llm";
dotenv.config({ path: resolve(import.meta.dirname, "../../../.env.local") });
for (const tier of ["flash", "pro"] as const) {
  for (const max of [32768, 65536]) {
    try {
      const r = await generateText({ model: llm(tier), prompt: "回复一个字：好", maxOutputTokens: max, maxRetries: 0 });
      console.log(`${tier} max=${max} OK finish=${r.finishReason} text=${JSON.stringify(r.text.slice(0, 10))}`);
    } catch (e) {
      console.log(`${tier} max=${max} ERR ${(e as Error).message.slice(0, 200).replace(/\n/g, " ")}`);
    }
  }
}
