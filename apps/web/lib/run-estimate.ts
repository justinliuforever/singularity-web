// Minutes per REQUESTED item, not per analyzed one — a run rarely lands every item it asks
// for, so the per-analyzed mean (xhs 5.8 / douyin 3.5 / youtube 10.9) would over-gate and
// reject work a user can afford. Measured from quota_charged / config.limit on settled runs:
// xhs 5.0 @15, douyin 4.0 @3, douyin 2.74 @50. Rounded down so the gate errs toward letting
// a run start; the worker still settles the real amount.
const MINUTES_PER_REQUESTED_ITEM: Record<string, number> = {
  xhs: 4,
  douyin: 3,
  youtube: 8,
};

export function estimateRunMinutes(platform: string, itemCount: number): number {
  if (itemCount <= 0) return 0;
  return Math.round((MINUTES_PER_REQUESTED_ITEM[platform] ?? 4) * itemCount);
}
