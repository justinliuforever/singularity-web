import "server-only";

import { errorEvents } from "@goooose/db";

import { db } from "./db";

type LogInput = {
  message: string;
  stack?: string | null;
  route?: string | null;
  method?: string | null;
  kind?: string | null;
  digest?: string | null;
  userId?: string | null;
  meta?: Record<string, unknown> | null;
};

// Fire-and-forget error capture into our own DB (own-DB observability). Never throws —
// a failing log must not break the request that triggered it.
export async function logServerError(input: LogInput): Promise<void> {
  try {
    await db.insert(errorEvents).values({
      message: input.message.slice(0, 4000),
      stack: input.stack?.slice(0, 8000) ?? null,
      // Sink-side strip: the OIDC callback carries a live code + state in its query.
      route: input.route?.split("?")[0]?.slice(0, 512) ?? null,
      method: input.method ?? null,
      kind: input.kind ?? null,
      digest: input.digest ?? null,
      userId: input.userId ?? null,
      meta: input.meta ?? null,
    });
  } catch (e) {
    // Never take down the request path — but keep a trace in the function log so a
    // failing error-logger isn't itself invisible (else the panel would falsely read healthy).
    console.error("logServerError failed:", e);
  }
}
