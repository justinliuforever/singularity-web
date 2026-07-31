import { NextResponse } from "next/server";

import { createUsageSink } from "@goooose/db";
import { buildXhsNoteUrl, getXhsNoteXsecToken } from "@goooose/integrations/clients/xhs";
import { runWithUsage } from "@goooose/integrations/metering";

import { db } from "@/lib/db";
import { rateLimitOk } from "@/server/access-code";
import { ensureCurrentUser } from "@/lib/users";

// Link resolution goes through TikHub, whose client retries for up to 90s.
export const maxDuration = 30;

const NOTE_ID = /^[a-f0-9]{16,32}$/i;
const usageSink = createUsageSink(db);

const CACHE_TTL_MS = 30 * 60_000; // well under token lifetime, so cached tokens stay valid
const tokenCache = new Map<string, { token: string; exp: number }>();

// Fresh xsec_token at click time — tokens expire, so they can't be baked into stored URLs.
export async function GET(request: Request): Promise<NextResponse> {
  const noteId = new URL(request.url).searchParams.get("note") ?? "";
  if (!NOTE_ID.test(noteId)) return new NextResponse("invalid note id", { status: 400 });

  const user = await ensureCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/api/auth/sign-in", request.url));
  if (user.accessStatus !== "approved") {
    return NextResponse.redirect(new URL("/request-access", request.url));
  }

  const now = Date.now();
  const cached = tokenCache.get(noteId);
  if (cached && cached.exp > now) {
    return NextResponse.redirect(buildXhsNoteUrl(noteId, cached.token));
  }

  // Per-user cap on cache-miss resolves — each spends the shared TikHub key.
  if (!rateLimitOk(`xhs-token:${user.id}`, 60)) {
    return new NextResponse("rate limited", { status: 429 });
  }

  try {
    const token = await runWithUsage(
      { userId: user.id, feature: "web", sink: usageSink },
      () => getXhsNoteXsecToken(noteId),
    );
    if (token) {
      if (tokenCache.size > 2000) tokenCache.clear();
      tokenCache.set(noteId, { token, exp: now + CACHE_TTL_MS });
    }
    return NextResponse.redirect(buildXhsNoteUrl(noteId, token));
  } catch {
    return NextResponse.redirect(buildXhsNoteUrl(noteId));
  }
}
