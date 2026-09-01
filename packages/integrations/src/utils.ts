export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Model APIs stream for minutes, so they can't take the data clients' 30s cap — but with no
// cap at all a stalled connection blocks the calling task until Trigger.dev's maxDuration.
// Wraps fetch instead of passing a signal per call so every request through a provider gets it.
export function withRequestTimeout(timeoutMs: number): typeof fetch {
  return (input, init) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    // Providers pass their own signal for user aborts — keep both live, don't replace it.
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return fetch(input, { ...init, signal });
  };
}

// Timeout so a stalled redirect hop can't hang the run; any failure returns the input unchanged.
export async function expandShortLink(input: string, shortLink: string | null): Promise<string> {
  if (!shortLink) return input;
  try {
    const res = await fetch(shortLink, {
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
      headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" },
    });
    void res.body?.cancel(); // only res.url is needed — release the socket
    return res.url || input;
  } catch {
    return input;
  }
}

// Strip NULL bytes — Postgres TEXT rejects them.
export function safeText(v: string | null | undefined): string | null {
  if (v == null) return null;
  const cleaned = v.replace(/\u0000/g, "");
  return cleaned === "" ? null : cleaned;
}

export function asPositiveNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

// "m:ss" / "h:mm:ss" / plain seconds → seconds (0 on anything unparsable).
export function parseDurationToSec(text: string | number | undefined): number {
  if (text == null || text === "") return 0;
  if (typeof text === "number") return text;
  const parts = text.split(":").map((p) => Number(p));
  if (parts.some((p) => Number.isNaN(p))) return 0;
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  return 0;
}

// Lenient parse; callers validate the unknown with their own zod schema.
export async function parseLlmJson(raw: string, kind: "object" | "array" = "object"): Promise<unknown> {
  const open = kind === "object" ? "{" : "[";
  const close = kind === "object" ? "}" : "]";
  let text = raw.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  }
  const start = text.indexOf(open);
  const end = text.lastIndexOf(close);
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  try {
    return JSON.parse(text);
  } catch {
    const { jsonrepair } = await import("jsonrepair");
    return JSON.parse(jsonrepair(text));
  }
}
