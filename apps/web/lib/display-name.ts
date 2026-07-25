// XHS share titles wrap nicknames as "@nick's profile" / "@nick的个人主页". The scraper
// strips them now, but rows stored before that fix still carry the suffix.
export function cleanProfileName(name: string): string {
  return name
    .replace(/^@/, "")
    // XHS emits U+2018 LEFT single quote in some locales — cover all three quote forms.
    .replace(/['’‘]s profile$/i, "")
    .replace(/的个人主页$/, "")
    .trim();
}
