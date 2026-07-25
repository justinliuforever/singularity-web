import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { after } from "next/server";

import { logServerError } from "@/lib/log-error";
import { createContext } from "@/server/trpc/init";
import { appRouter } from "@/server/trpc/routers";

function handler(request: Request) {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: request,
    router: appRouter,
    createContext,
    // instrumentation's onRequestError never sees tRPC — it catches the error itself — so
    // without this the ops panel reads "0 errors" while every mutation fails. Only real
    // faults: expected rejections (UNAUTHORIZED on a lapsed session, quota FORBIDDEN)
    // would bury them. Never store input — it carries bible text and script briefs.
    onError: ({ error, path, type, ctx }) => {
      if (error.code !== "INTERNAL_SERVER_ERROR") return;
      after(
        logServerError({
          message: error.message,
          stack: error.stack ?? null,
          route: `trpc/${path ?? "unknown"}`,
          method: type,
          kind: "tRPC",
          userId: ctx?.user?.id ?? null,
        }),
      );
    },
  });
}

export { handler as GET, handler as POST };
