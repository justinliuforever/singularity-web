import { NextResponse } from "next/server";

import { eq } from "drizzle-orm";

import { clerkVideos, createUsageSink } from "@goooose/db";
import { getDouyinVideoDetail } from "@goooose/integrations/clients/douyin";
import { runWithUsage } from "@goooose/integrations/metering";

import { db } from "@/lib/db";
import { rateLimitOk } from "@/server/access-code";
import { ensureCurrentUser } from "@/lib/users";

// A cover miss resolves through TikHub, whose client retries for up to 90s.
export const maxDuration = 30;

const AWEME_ID = /^\d{15,21}$/;
const usageSink = createUsageSink(db);

// Douyin cover CDN URLs are signed with an ~2 week x-expires, so a stored thumbnail_url
// 403s after expiry — re-resolve by aweme_id at view time.
const CACHE_TTL_MS = 60 * 60_000;
const coverCache = new Map<string, { url: string; exp: number }>();
// Only inside the last day of the signature's life; earlier, the stored URL still works and
// a TikHub call buys nothing.
const RESIGN_MARGIN_MS = 24 * 60 * 60_000;

function freshUntil(url: string): number {
  const exp = new URL(url).searchParams.get("x-expires");
  const secs = exp ? Number(exp) : NaN;
  return Number.isFinite(secs) ? secs * 1000 : 0;
}

export async function GET(request: Request): Promise<NextResponse> {
  const awemeId = new URL(request.url).searchParams.get("v") ?? "";
  if (!AWEME_ID.test(awemeId)) return new NextResponse("invalid id", { status: 400 });

  const user = await ensureCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/api/auth/sign-in", request.url));
  if (user.accessStatus !== "approved") {
    return NextResponse.redirect(new URL("/request-access", request.url));
  }

  const now = Date.now();
  const cached = coverCache.get(awemeId);
  if (cached && cached.exp > now) return NextResponse.redirect(cached.url);

  const [stored] = await db
    .select({ url: clerkVideos.thumbnailUrl })
    .from(clerkVideos)
    .where(eq(clerkVideos.platformVideoId, awemeId))
    .limit(1);
  if (stored?.url && freshUntil(stored.url) > now + RESIGN_MARGIN_MS) {
    return NextResponse.redirect(stored.url);
  }

  if (!rateLimitOk(`douyin-cover:${user.id}`, 60)) {
    return new NextResponse("rate limited", { status: 429 });
  }

  try {
    const detail = await runWithUsage(
      { userId: user.id, feature: "web", sink: usageSink },
      () => getDouyinVideoDetail(awemeId),
    );
    const url = detail?.coverUrl;
    if (!url) return new NextResponse("no cover", { status: 404 });
    if (coverCache.size > 2000) coverCache.clear();
    coverCache.set(awemeId, { url, exp: now + CACHE_TTL_MS });
    return NextResponse.redirect(url);
  } catch {
    return new NextResponse("resolve failed", { status: 502 });
  }
}
