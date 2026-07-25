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
    // tRPC swallows its own errors, so onRequestError never sees them and the ops panel
    // would read "0 errors". Real faults only; never store input (bible text, script briefs).
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
