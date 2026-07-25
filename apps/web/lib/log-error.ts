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

// Never throws: a failing log must not break the request that triggered it.
export async function logServerError(input: LogInput): Promise<void> {
  try {
    await db.insert(errorEvents).values({
      message: input.message.slice(0, 4000),
      stack: input.stack?.slice(0, 8000) ?? null,
      // Strip the query: the OIDC callback carries a live code + state.
      route: input.route?.split("?")[0]?.slice(0, 512) ?? null,
      method: input.method ?? null,
      kind: input.kind ?? null,
      digest: input.digest ?? null,
      userId: input.userId ?? null,
      meta: input.meta ?? null,
    });
  } catch (e) {
    // Swallowing silently would make the ops panel read healthy while capture is broken.
    console.error("logServerError failed:", e);
  }
}
