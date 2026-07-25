// Round to a granularity that matches the magnitude — false precision reads as broken.
function roundSec(s: number): number {
  if (s < 300) return Math.round(s / 30) * 30;
  if (s < 1800) return Math.round(s / 60) * 60;
  return Math.round(s / 300) * 300;
}

function unitParts(sec: number): { value: number; unit: "秒" | "分钟" } {
  const s = Math.max(0, roundSec(sec));
  if (s < 60) return { value: Math.max(s, 15), unit: "秒" };
  return { value: Math.round(s / 60), unit: "分钟" };
}

export function formatEtaRange(loSec: number, hiSec: number): string {
  const lo = unitParts(Math.min(loSec, hiSec));
  const hi = unitParts(Math.max(loSec, hiSec));
  if (lo.value === hi.value && lo.unit === hi.unit) return `约 ${lo.value} ${lo.unit}`;
  if (lo.unit === hi.unit) return `约 ${lo.value}–${hi.value} ${lo.unit}`;
  return `约 ${lo.value} ${lo.unit} – ${hi.value} ${hi.unit}`;
}

// A displayed ETA that jumps upward reads as broken: rises are capped at the historical
// ceiling (T1 p90, the legitimate concurrency-tail case), decay is free.
export function clampEta(prev: number | null, candidate: number, ceilingSec = Infinity): number {
  const c = Math.max(0, Math.min(candidate, ceilingSec));
  if (prev == null) return c;
  if (c > prev) return Math.min(c, ceilingSec);
  return c;
}
