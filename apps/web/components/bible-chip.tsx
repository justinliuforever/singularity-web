import Link from "next/link";

// Account-level 频道圣经 indicator — read-only everywhere except the account bible page.
export function BibleChip({
  name,
  manageHref,
  awaitingReviewCount = 0,
  variant = "header",
}: {
  name: string | null;
  manageHref: string;
  // Parked imports are neither active nor absent — reading 未设置 over a finished import
  // is what made a successful generation look like it never ran.
  awaitingReviewCount?: number;
  variant?: "header" | "band";
}) {
  const awaiting = !name && awaitingReviewCount > 0;
  if (variant === "band") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-dashed bg-muted/30 px-3 py-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-1.5 text-xs">
            <span>📖</span>
            <span className="shrink-0 text-muted-foreground">频道圣经：</span>
            <span className="truncate font-medium">
              {name ?? (awaiting ? `${awaitingReviewCount} 份待确认` : "未设置")}
            </span>
          </span>
          <span className="text-[10px] text-muted-foreground">账号通用 · 在这里只读</span>
        </div>
        <Link
          href={manageHref}
          className="shrink-0 text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          {name ? "在账号页管理 →" : awaiting ? "去确认 →" : "去生成 →"}
        </Link>
      </div>
    );
  }
  return (
    <Link
      href={manageHref}
      title={
        awaiting
          ? "圣经已生成，还有存疑项待确认，确认后才会生效"
          : "账号通用圣经 · 全部项目共用，点击管理"
      }
      className={`flex min-w-0 shrink items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] transition-colors ${
        name
          ? "text-muted-foreground hover:text-foreground"
          : "border-amber-500/50 text-amber-600 dark:text-amber-400"
      }`}
    >
      <span>📖</span>
      <span className="max-w-[10rem] truncate">
        {name ? `圣经·${name}` : awaiting ? `圣经·${awaitingReviewCount} 份待确认` : "圣经·未设置"}
      </span>
    </Link>
  );
}
