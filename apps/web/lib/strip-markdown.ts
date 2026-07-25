// Previews only. Also drops the machine "TOPIC:" anchor line that bible/topic text carries.
export function stripMarkdown(md: string | null | undefined): string {
  if (!md) return "";
  return md
    .replace(/^TOPIC:\s*/im, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\n{2,}/g, " · ")
    .replace(/\n/g, " ")
    .trim();
}
