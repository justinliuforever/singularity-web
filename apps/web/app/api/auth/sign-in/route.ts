import { getLogtoContext, signIn } from "@logto/next/server-actions";
import { NextResponse, type NextRequest } from "next/server";

import { logtoConfig } from "@/lib/logto";

export async function GET(request: NextRequest) {
  // Minting overwrites Logto's single cookie slot, so a background request landing here
  // invalidates the state the user's real tab will return with. Guarded here, not in
  // proxy.ts, whose matcher excludes /api/* — api/douyin-cover redirects here from an
  // <Image src>.
  const dest = request.headers.get("sec-fetch-dest");
  if (request.headers.get("rsc") === "1" || (dest && dest !== "document")) {
    return new Response(null, { status: 401 });
  }

  const { isAuthenticated } = await getLogtoContext(logtoConfig);
  if (isAuthenticated) return NextResponse.redirect(new URL("/", request.url));

  await signIn(logtoConfig);
  return new Response(null, { status: 200 });
}
