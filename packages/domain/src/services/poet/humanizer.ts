import { generateText } from "ai";

import { llm } from "@goooose/integrations/clients/llm";
import { buildChineseHumanizerPrompt } from "@goooose/prompts/poet";

export async function humanizeChinese(scriptText: string, maxChars?: number): Promise<string> {
  try {
    const result = await generateText({
      model: llm("pro"),
      prompt: buildChineseHumanizerPrompt(scriptText, maxChars),
      temperature: 0.6,
      maxOutputTokens: 16384,
      maxRetries: 2,
    });
    const out = result.text.trim();
    // 0.6 floor: de-AI compression genuinely shrinks zh text, but a gutted rewrite must still be caught.
    if (!out || result.finishReason === "length") {
      console.warn(`[poet:humanize] discarded (finish=${result.finishReason}); keeping draft`);
      return scriptText;
    }
    if (out.length < scriptText.length * 0.6) {
      console.warn(
        `[poet:humanize] discarded (shrank ${scriptText.length}→${out.length}, <0.6x); keeping draft`,
      );
      return scriptText;
    }
    // The writer already hit the duration window, so an inflated rewrite (historically a
    // 2-3× short-form blowup) loses to the draft.
    if (maxChars && out.length > maxChars * 1.15 && out.length > scriptText.length) {
      console.warn(
        `[poet:humanize] discarded (inflated ${scriptText.length}→${out.length} > ${maxChars}×1.15); keeping draft`,
      );
      return scriptText;
    }
    return out;
  } catch {
    return scriptText;
  }
}
