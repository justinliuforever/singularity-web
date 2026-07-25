// Browser-safe: imported by client-side form schemas, so this module must never pull in
// node-only APIs (the API clients do).

const XHS_USER_ID_RE = /^[a-f0-9]{24}$/i;

export function isValidYoutubeChannelUrl(input: string): boolean {
  const s = input.trim();
  if (!s) return false;
  try {
    const u = new URL(s);
    if (!u.hostname.endsWith("youtube.com") && !u.hostname.endsWith("youtu.be")) {
      return false;
    }
    const p = u.pathname;
    return (
      /^\/@[\w.-]+/.test(p) ||
      /^\/channel\/UC[\w-]+/.test(p) ||
      /^\/c\/[\w.-]+/.test(p) ||
      /^\/user\/[\w.-]+/.test(p)
    );
  } catch {
    return false;
  }
}

// Mobile share pastes wrap the short link in card text, so scan rather than parse.
const XHS_SHORT_LINK_RE = /https?:\/\/(?:[\w-]+\.)?xhslink\.com\/[^\s"'<>，。；！？]+/i;

export function findXhsShortLink(input: string): string | null {
  return input.match(XHS_SHORT_LINK_RE)?.[0] ?? null;
}

export function isValidXhsProfileUrl(input: string): boolean {
  const s = input.trim();
  if (!s) return false;
  if (XHS_USER_ID_RE.test(s)) return true;
  // No network in this module — accept and let the server expand and validate the real target.
  if (findXhsShortLink(s)) return true;
  try {
    const u = new URL(s);
    if (!u.hostname.endsWith("xiaohongshu.com")) return false;
    return /\/user\/profile\/[a-f0-9]{24}/i.test(u.pathname);
  } catch {
    return false;
  }
}

// sec_user_id always opens with the MS4wLjABAAAA prefix; live samples run 55 or 76 chars total.
export const DOUYIN_SEC_UID_RE = /^MS4wLjABAAAA[A-Za-z0-9_-]{43,64}$/;
const DOUYIN_SHORT_LINK_RE = /https?:\/\/v\.douyin\.com\/[A-Za-z0-9_-]+/i;

export function findDouyinShortLink(input: string): string | null {
  return input.match(DOUYIN_SHORT_LINK_RE)?.[0] ?? null;
}

// Sniff which platform a pasted VIDEO/NOTE link belongs to. Null (not a youtube
// default) so unrecognizable lines can be surfaced to the user instead of guessed.
export function detectVideoLinkPlatform(line: string): "xhs" | "douyin" | "youtube" | null {
  const s = line.trim();
  if (!s) return null;
  if (/xiaohongshu\.com|xhslink\.com/i.test(s)) return "xhs";
  if (/douyin\.com|iesdouyin\.com/i.test(s)) return "douyin";
  if (/youtube\.com|youtu\.be/i.test(s) || /^[A-Za-z0-9_-]{11}$/.test(s)) return "youtube";
  return null;
}

export function extractYoutubeVideoId(input: string): string | null {
  const s = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  // Pasted text can wrap the URL in title/emoji, so new URL(s) throws on the whole
  // string — scan for an embedded watch/shorts/youtu.be id first (anchored to its
  // URL context so an arbitrary 11-char substring can't false-match).
  const embedded =
    s.match(/[?&]v=([A-Za-z0-9_-]{11})/) ??
    s.match(/(?:youtu\.be|\/shorts|\/live|\/embed|\/v)\/([A-Za-z0-9_-]{11})/);
  if (embedded) return embedded[1]!;
  try {
    const parsed = new URL(s);
    if (parsed.hostname.includes("youtu.be")) {
      const id = parsed.pathname.replace(/^\//, "").slice(0, 11);
      if (/^[A-Za-z0-9_-]{11}$/.test(id)) return id;
    }
    if (parsed.hostname.includes("youtube.com")) {
      if (parsed.pathname.replace(/\/$/, "") === "/watch") {
        const v = parsed.searchParams.get("v") ?? "";
        if (/^[A-Za-z0-9_-]{11}$/.test(v)) return v;
      }
      const m = parsed.pathname.match(/\/(?:shorts|live|embed|v)\/([A-Za-z0-9_-]{11})/);
      if (m) return m[1]!;
    }
  } catch {
    /* fall through */
  }
  return null;
}

export function isValidDouyinProfileUrl(input: string): boolean {
  const s = input.trim();
  if (!s) return false;
  if (DOUYIN_SEC_UID_RE.test(s)) return true;
  // No network in this module — accept and let the server expand.
  if (findDouyinShortLink(s)) return true;
  try {
    const u = new URL(s);
    const host = u.hostname.toLowerCase();
    // Covers douyin.com, www.douyin.com and iesdouyin.com (share host).
    if (!host.endsWith("douyin.com")) return false;
    return (
      /\/user\/MS4wLjABAAAA[A-Za-z0-9_-]{43,64}/.test(u.pathname) ||
      /\/share\/user\/MS4wLjABAAAA[A-Za-z0-9_-]{43,64}/.test(u.pathname)
    );
  } catch {
    return false;
  }
}
