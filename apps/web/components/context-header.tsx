"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";

import { trpc } from "@/lib/trpc";
import { BibleChip } from "@/components/bible-chip";

// Route shapes that carry account/project context. Clerk is account-level (no project).
function parseContext(
  pathname: string,
): { kind: "accounts" | "clerk"; accountSlug: string; projectSlug?: string } | null {
  const seg = pathname.split("/").filter(Boolean).map((s) => decodeURIComponent(s));
  if (seg[0] === "accounts" && seg[1] && seg[1] !== "new") {
    if (seg[2] === "projects" && seg[3] && seg[3] !== "new") {
      return { kind: "accounts", accountSlug: seg[1], projectSlug: seg[3] };
    }
    return { kind: "accounts", accountSlug: seg[1] };
  }
  if (seg[0] === "clerk" && seg[1]) {
    return { kind: "clerk", accountSlug: seg[1] };
  }
  return null;
}

export function ContextHeader() {
  const pathname = usePathname();
  const parsed = parseContext(pathname);
  const { data } = trpc.channels.context.useQuery(
    { accountSlug: parsed?.accountSlug ?? "", projectSlug: parsed?.projectSlug },
    { enabled: !!parsed, staleTime: 60_000 },
  );

  if (!parsed || !data) return null;

  const a = encodeURIComponent(data.account.slug);
  return (
    <nav className="flex min-w-0 items-center gap-1.5 text-xs">
      {parsed.kind === "clerk" ? (
        <>
          <Link
            href="/clerk"
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            Clerk · 分析师
          </Link>
          <ChevronRight className="size-3 shrink-0 text-muted-foreground opacity-50" />
        </>
      ) : null}
      <Link
        href={`/accounts/${a}`}
        className="flex min-w-0 items-center gap-1.5 text-muted-foreground hover:text-foreground"
      >
        <span className="truncate font-medium text-foreground">{data.account.name}</span>
        <span className="font-mono text-[10px] uppercase opacity-70">{data.account.platform}</span>
      </Link>
      <BibleChip
        name={data.account.activeBible?.name ?? null}
        parkedCount={data.account.parkedBibleCount}
        parkedUnresolvedCount={data.account.parkedUnresolvedCount}
        manageHref={`/accounts/${a}/bible`}
      />
      {data.project && data.project.slug !== data.account.slug ? (
        // Default project shares the account's slug AND name — a second crumb would
        // just repeat it. Only named (future multi-) projects get their own crumb.
        <>
          <ChevronRight className="size-3 shrink-0 text-muted-foreground opacity-50" />
          <Link
            href={`/accounts/${a}/projects/${encodeURIComponent(data.project.slug)}`}
            className="flex min-w-0 items-center gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <span className="truncate font-medium text-foreground">{data.project.name}</span>
          </Link>
        </>
      ) : null}
    </nav>
  );
}
