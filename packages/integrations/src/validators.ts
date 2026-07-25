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
