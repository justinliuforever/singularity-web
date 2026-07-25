export const ZH_CHARS_PER_MINUTE = 200;
export const EN_WORDS_PER_MINUTE = 150;

// Seconds, not minutes: short videos (≤60s) need sub-minute spans.
export const MIN_DURATION_SECONDS = 15;
export const MAX_DURATION_SECONDS = 3600;
export const DEFAULT_DURATION_SECONDS = 300;

export const LONG_FORM_THRESHOLD = {
  zh: 2000,
  en: 1500,
} as const;

export const DEFAULT_TARGET_WORD_COUNT = {
  zh: 1000, // ~5 min default, stays in short-form path
  en: 750,
} as const;

export function rateForLanguage(language: "zh" | "en"): number {
  return language === "zh" ? ZH_CHARS_PER_MINUTE : EN_WORDS_PER_MINUTE;
}

export function computeTargetWordCount(
  durationSeconds: number | null | undefined,
  language: "zh" | "en",
): number {
  if (!durationSeconds || durationSeconds <= 0) {
    return DEFAULT_TARGET_WORD_COUNT[language];
  }
  return Math.round((durationSeconds / 60) * rateForLanguage(language));
}

export function isLongForm(targetWordCount: number, language: "zh" | "en"): boolean {
  return targetWordCount >= LONG_FORM_THRESHOLD[language];
}

// Section markers and markdown emphasis aren't spoken, so they must not count toward a
// budget that is a spoken-duration promise.
export function countWords(text: string, language: "zh" | "en"): number {
  const spoken = (text ?? "").replace(/\[[A-Z][A-Z0-9 ]*\]/g, "").replace(/\*\*/g, "");
  return language === "zh"
    ? spoken.replace(/\s+/g, "").length
    : spoken.trim().split(/\s+/).filter(Boolean).length;
}

export function formatDurationLabel(seconds: number | null | undefined): string | null {
  if (!seconds || seconds <= 0) return null;
  if (seconds < 60) return `${seconds} 秒`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `约 ${m} 分钟` : `约 ${m} 分 ${s} 秒`;
}

export type DriftReason = "no_overlap" | "ai_markers" | "topic_substitution";

export type DriftWarning = {
  reason: DriftReason;
  claimedTopic: string;
  sampleUserTerms: string[];
  humanMessage: string;
  markerHits?: number;
};
