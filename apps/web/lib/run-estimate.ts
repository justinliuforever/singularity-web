// Minutes per REQUESTED item, not per analyzed one: a run rarely lands every item it asks
// for, so the per-analyzed mean would over-gate and reject work a user can afford. Measured
// from quota_charged / config.limit on settled runs, rounded down — the worker settles the
// real amount, so the gate should err toward letting a run start.
const MINUTES_PER_REQUESTED_ITEM: Record<string, number> = {
  xhs: 4,
  douyin: 3,
  youtube: 8,
};

export function estimateRunMinutes(platform: string, itemCount: number): number {
  if (itemCount <= 0) return 0;
  return Math.round((MINUTES_PER_REQUESTED_ITEM[platform] ?? 4) * itemCount);
}
