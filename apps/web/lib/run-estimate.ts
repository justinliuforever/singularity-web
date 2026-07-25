// Mean billed minutes per analyzed item, measured from prod (clerk_videos joined to the
// billing rule): xhs 5.8, douyin 3.5, youtube 10.9. Used only to size the pre-flight quota
// check for batch runs — the worker still settles actual minutes at run end. Plain numbers
// with no imports so the start sheets can show the same figure the server gates on.
const MINUTES_PER_ITEM: Record<string, number> = {
  xhs: 6,
  douyin: 4,
  youtube: 11,
};

export function estimateRunMinutes(platform: string, itemCount: number): number {
  if (itemCount <= 0) return 0;
  return Math.round((MINUTES_PER_ITEM[platform] ?? 6) * itemCount);
}
