import { getLogtoContext, handleSignIn } from "@logto/next/server-actions";
import { cookies } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import type { NextRequest } from "next/server";

import { eq } from "drizzle-orm";

import { loginEvents, users } from "@goooose/db";

import { db } from "@/lib/db";
import { logtoConfig } from "@/lib/logto";
import { BETA_CODE_COOKIE, redeemAccessCode } from "@/server/access-code";
import { ensureCurrentUser } from "@/lib/users";

export async function GET(request: NextRequest) {
  // A route handler throw is a bare 500 with no body — error.tsx cannot cover it. Logto
  // clears the sign-in session on success, so a reload or browser Back replays a spent
  // code and fails deterministically; without this it is a white screen the user can only
  // escape by retyping the domain.
  try {
    await handleSignIn(logtoConfig, request.nextUrl.searchParams);
  } catch (err) {
    unstable_rethrow(err);
    const { isAuthenticated } = await getLogtoContext(logtoConfig).catch(() => ({
      isAuthenticated: false,
    }));
    console.error("sign-in callback failed", err);
    redirect(isAuthenticated ? "/" : "/sign-in-failed?reason=expired");
  }
  // One row per completed sign-in — feeds the admin user-detail view. Never
  // block the login redirect on bookkeeping.
  let user = null;
  try {
    user = await ensureCurrentUser();
    if (user) {
      const ip =
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        request.headers.get("x-real-ip");
      await db.insert(loginEvents).values({
        userId: user.id,
        ip: ip || null,
        userAgent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
      });
      await db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, user.id));
    }
  } catch (err) {
    console.error("login event bookkeeping failed", err);
  }
  // Landing stashed a validated invite code before pushing through Logto; redeem
  // now and always drop the cookie so a bad code can't loop. Failures fall through
  // to the /request-access code box.
  const betaCode = request.cookies.get(BETA_CODE_COOKIE)?.value;
  let codeFailed = false;
  if (betaCode) {
    if (user) {
      try {
        const result = await redeemAccessCode(user, betaCode);
        codeFailed = !result.approved;
      } catch (err) {
        console.error("beta code auto-redeem failed", err);
        codeFailed = true;
      }
    }
    (await cookies()).delete(BETA_CODE_COOKIE);
  }
  // redirect() throws — it must stay outside every try above.
  if (codeFailed) redirect("/request-access?code=failed");
  redirect("/welcome");
}
