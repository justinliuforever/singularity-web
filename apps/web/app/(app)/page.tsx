import { redirect } from "next/navigation";

import { getSidebarAccounts } from "@/lib/sidebar-data";
import { ensureCurrentUser } from "@/lib/users";

// New users have no own account yet, so they land in Clerk to analyze benchmarks first.
export default async function HomePage() {
  const user = await ensureCurrentUser();
  if (!user) return null;

  const accounts = await getSidebarAccounts(user.id);
  if (accounts.length === 0) redirect("/clerk");
  redirect(`/accounts/${encodeURIComponent(accounts[0]!.slug)}`);
}
