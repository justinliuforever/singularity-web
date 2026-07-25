import "server-only";

import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";

import { channels, projects, type Channel, type Project } from "@goooose/db";

import { db } from "./db";
import { ensureCurrentUser } from "./users";

// Slugs are unique only per (user_id, slug), so every lookup must scope by the current
// user; resolving centrally keeps a new page from reintroducing the cross-user bug.
export async function resolveOwnedChannel(
  slug: string,
): Promise<{ user: NonNullable<Awaited<ReturnType<typeof ensureCurrentUser>>>; channel: Channel }> {
  const user = await ensureCurrentUser();
  if (!user) notFound();
  const [channel] = await db
    .select()
    .from(channels)
    .where(and(eq(channels.userId, user.id), eq(channels.slug, slug)))
    .limit(1);
  if (!channel) notFound();
  return { user, channel };
}

export async function resolveOwnedProject(
  slug: string,
  projectSlug: string,
): Promise<{
  user: NonNullable<Awaited<ReturnType<typeof ensureCurrentUser>>>;
  channel: Channel;
  project: Project;
}> {
  const { user, channel } = await resolveOwnedChannel(slug);
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.ownAccountId, channel.id), eq(projects.slug, projectSlug)))
    .limit(1);
  if (!project) notFound();
  return { user, channel, project };
}
