import Link from "next/link";

export function BibleChip({
  name,
  manageHref,
  parkedCount = 0,
  parkedUnresolvedCount = 0,
  variant = "header",
}: {
  name: string | null;
  manageHref: string;
  // A parked bible is neither live nor absent: showing 未设置 over a finished import
  // made a successful generation look like it never ran.
  parkedCount?: number;
  parkedUnresolvedCount?: number;
  variant?: "header" | "band";
}) {
  const parked = !name && parkedCount > 0;
  const label = parked
    ? parkedUnresolvedCount > 0
      ? `${parkedUnresolvedCount} 份待确认`
      : `${parkedCount} 份待启用`
    : (name ?? "未设置");
  const action = name ? "在账号页管理 →" : parked ? "去处理 →" : "去生成 →";

  if (variant === "band") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-dashed bg-muted/30 px-3 py-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-1.5 text-xs">
            <span>📖</span>
            <span className="shrink-0 text-muted-foreground">频道圣经：</span>
            <span className="truncate font-medium">{label}</span>
          </span>
          <span className="text-[10px] text-muted-foreground">账号通用 · 在这里只读</span>
        </div>
        <Link
          href={manageHref}
          className="shrink-0 text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          {action}
        </Link>
      </div>
    );
  }
  return (
    <Link
      href={manageHref}
      title={
        parked
          ? "圣经已生成但还没生效，点击处理"
          : "账号通用圣经 · 全部项目共用，点击管理"
      }
      className={`flex min-w-0 shrink items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] transition-colors ${
        name
          ? "text-muted-foreground hover:text-foreground"
          : "border-amber-500/50 text-amber-600 dark:text-amber-400"
      }`}
    >
      <span>📖</span>
      <span className="max-w-[10rem] truncate">{`圣经·${label}`}</span>
    </Link>
  );
}
