import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@goooose/db";

const globalForDb = globalThis as unknown as {
  __pgClient?: ReturnType<typeof postgres>;
};

// Cached in production too: Fluid Compute keeps an instance warm across requests, and a second
// pool per module evaluation would hold its own idle connections against the 60-slot budget.
// max is small on purpose — Supavisor multiplexes in transaction mode, so a wide client-side
// pool buys nothing. Without idle_timeout (postgres.js defaults to null) a frozen instance
// never returns its connections.
const client =
  globalForDb.__pgClient ??
  postgres(process.env.DATABASE_URL!, { prepare: false, max: 5, idle_timeout: 20 });

globalForDb.__pgClient = client;

export const db = drizzle(client, { schema });
