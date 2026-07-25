import { extractDouyinSecUserId } from "@goooose/integrations/clients/douyin";
import { extractXhsUserId } from "@goooose/integrations/clients/xhs";
import { parseYoutubeChannelUrl } from "@goooose/integrations/clients/youtube-data";

export type CompetitorKey = { key: string; needsResolution: boolean };

// Offline dedup key. YouTube @handles and legacy /c//user/ URLs can't be canonicalized
// without network, so they get a provisional key flagged needsResolution until the
// resolveChannelId pass rewrites it to a UC id. Must mirror the backfill so new imports
// dedup against backfilled rows.
export function provisionalCompetitorKey(
  platform: "youtube" | "xhs" | "douyin",
  url: string,
): CompetitorKey | null {
  const trimmed = (url || "").trim();
  if (platform === "xhs") {
    const id = extractXhsUserId(trimmed);
    return id ? { key: id.toLowerCase(), needsResolution: false } : null;
  }
  if (platform === "douyin") {
    // sec_user_id is case-sensitive base64url — never lowercase it.
    const id = extractDouyinSecUserId(trimmed);
    return id ? { key: id, needsResolution: false } : null;
  }
  const parsed = parseYoutubeChannelUrl(trimmed);
  if (!parsed) return null;
  if (parsed.type === "id") return { key: parsed.channelId, needsResolution: false };
  if (parsed.type === "handle") return { key: `@${parsed.handle.toLowerCase()}`, needsResolution: true };
  return { key: trimmed.toLowerCase(), needsResolution: true };
}
