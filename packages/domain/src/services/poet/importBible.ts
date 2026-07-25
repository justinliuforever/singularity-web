import type { ImportFlag } from "@goooose/integrations/clients/docTranscribe";
import { generateTextWithFallback } from "@goooose/integrations/clients/llm";
import { buildBibleFromDocumentPrompt } from "@goooose/prompts/poet";
import { redactUngrounded } from "../grounding";
import { checkDrift, extractHostLine, extractTopicLine } from "./bible";
import type { DriftWarning } from "../../schemas/poet";

export type { ImportFlag };

type Logger = { info?: (m: string) => void; warn?: (m: string) => void };

const digitTokens = (s: string) => new Set(s.match(/\d+(?:\.\d+)?/g) ?? []);

export type BibleFromDocumentResult = {
  content: string;
  topicClaimed: string;
  hostName: string | null;
  driftWarning: DriftWarning | null;
  flags: ImportFlag[];
};

export async function generateBibleFromDocument(
  args: {
    transcript: string;
    channelName?: string;
    language?: "en" | "zh";
    logger?: Logger;
  },
  onProgress?: (chars: number) => void | Promise<void>,
): Promise<BibleFromDocumentResult> {
  const flags: ImportFlag[] = [];
  const prompt = buildBibleFromDocumentPrompt({
    transcript: args.transcript,
    channelName: args.channelName,
    language: args.language,
  });
  // Pro-first: fidelity restructuring needs the stronger model (bake-off: 0 digit violations).
  let { text: content, finishReason } = await generateTextWithFallback({
    prompt,
    maxOutputTokens: 16384,
    temperature: 0.3,
  });
  content = content.trim();
  if (!content) throw new Error("Bible generation returned empty content");
  // A length-capped bible loses its trailing anchors (TOPIC_FRAMEWORK / FACT_SHEET) silently,
  // so flag it — the flag is what parks the bible for review instead of auto-activating it.
  let truncated = finishReason === "length";
  await onProgress?.(content.length);

  content = await redactUngrounded({
    draft: content,
    source: args.transcript,
    language: args.language,
    mode: "doc",
    logger: args.logger,
  });

  // Digit audit: every number in the bible must exist in the transcript.
  const transcriptDigits = digitTokens(args.transcript);
  let violations = [...digitTokens(content)].filter((n) => !transcriptDigits.has(n));
  if (violations.length > 0) {
    args.logger?.warn?.(`bible digit audit: ${violations.length} violations, regenerating once`);
    const retryPrompt = `${prompt}\n\n## PREVIOUS ATTEMPT REJECTED\nYour previous output contained numbers NOT present in the transcript: ${violations.join(", ")}. Regenerate strictly — every number must be copied verbatim from the transcript.`;
    const retry = await generateTextWithFallback({ prompt: retryPrompt, maxOutputTokens: 16384, temperature: 0.2 });
    const retryContent = retry.text.trim();
    if (retryContent) {
      const retryViolations = [...digitTokens(retryContent)].filter((n) => !transcriptDigits.has(n));
      if (retryViolations.length < violations.length) {
        content = await redactUngrounded({
          draft: retryContent,
          source: args.transcript,
          language: args.language,
          mode: "doc",
          logger: args.logger,
        });
        violations = [...digitTokens(content)].filter((n) => !transcriptDigits.has(n));
        truncated = retry.finishReason === "length";
      }
    }
  }
  if (violations.length > 0) {
    // Better no number than a wrong number: drop body lines still carrying unsupported digits.
    const lines = content.split("\n");
    const kept = lines.filter((line) => {
      if (/^(##|TOPIC:|HOST:)/.test(line.trim())) return true;
      return !violations.some((v) => line.includes(v));
    });
    if (kept.length < lines.length) {
      content = kept.join("\n");
      flags.push({
        type: "audit",
        detail: `数字审计：${violations.length} 个数字无法在转写中找到，包含它们的 ${lines.length - kept.length} 行已移除（${violations.slice(0, 8).join(", ")}${violations.length > 8 ? "…" : ""}）`,
      });
    } else {
      // Anchor/TOPIC/HOST lines are never dropped, so a violation confined to them removes
      // nothing — without this branch the bible would activate as if the audit had passed.
      flags.push({
        type: "audit_source",
        detail: `数字审计：${violations.length} 个数字无法在转写中找到，但它们位于标题或章节行，未自动移除（${violations.slice(0, 8).join(", ")}${violations.length > 8 ? "…" : ""}）`,
      });
    }
  }
  if (truncated) {
    flags.push({
      type: "truncated",
      detail: "圣经生成达到输出上限，末尾章节（选题框架 / 事实表）可能缺失；请对照原文件确认后补充",
    });
  }

  const topicClaimed = extractTopicLine(content);
  const hostName = extractHostLine(content);
  const driftWarning = checkDrift(args.transcript.slice(0, 4000), topicClaimed, content);
  return { content, topicClaimed, hostName, driftWarning, flags };
}
