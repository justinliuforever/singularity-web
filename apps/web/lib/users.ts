import "server-only";

import { eq } from "drizzle-orm";

import { getLogtoContext } from "@logto/next/server-actions";

import { allowedEmails, users, type User } from "@goooose/db";

import { db } from "./db";
import { logtoConfig } from "./logto";
import { APP_VERSION } from "./version";

type LogtoIdentity = {
  sub: string;
  email?: string | null;
  username?: string | null;
  name?: string | null;
};

async function upsertFromIdentity(identity: LogtoIdentity): Promise<User> {
  const email = identity.email ?? "";
  const displayName = identity.name ?? identity.username ?? null;

  // Single round trip: select-then-insert let concurrent first-login requests
  // collide on the logto_id unique.
  const [row] = await db
    .insert(users)
    .values({ logtoId: identity.sub, email, displayName, lastSeenVersion: APP_VERSION })
    .onConflictDoUpdate({
      target: users.logtoId,
      // lastSeenVersion deliberately absent: existing users keep theirs until they
      // dismiss the what's-new dialog.
      set: { email, displayName },
    })
    .returning();
  return row!;
}

async function autoApproveIfInvited(user: User): Promise<User> {
  if (user.accessStatus !== "pending" || !user.email) return user;
  const [invited] = await db
    .select({ email: allowedEmails.email })
    .from(allowedEmails)
    .where(eq(allowedEmails.email, user.email.toLowerCase()))
    .limit(1);
  if (!invited) return user;
  const [updated] = await db
    .update(users)
    .set({ accessStatus: "approved" })
    .where(eq(users.id, user.id))
    .returning();
  return updated ?? user;
}

export async function ensureCurrentUser(): Promise<User | null> {
  const { isAuthenticated, claims } = await getLogtoContext(logtoConfig);
  if (!isAuthenticated || !claims) {
    return null;
  }

  const user = await upsertFromIdentity({
    sub: claims.sub,
    email: claims.email,
    username: claims.username,
    name: claims.name,
  });
  return autoApproveIfInvited(user);
}
