import Link from "next/link";

import { Button } from "@/components/ui/button";
import { APP_VERSION_LABEL } from "@/lib/version";

const REASON_TEXT: Record<string, string> = {
  expired: "这个登录链接已经用过或已过期。",
  replay: "你已经登录了，这个链接不能重复打开。",
};

type Props = { searchParams: Promise<{ reason?: string }> };

// Terminal by design — auto-retrying here would turn a stuck login into an invisible loop.
export default async function SignInFailedPage({ searchParams }: Props) {
  const { reason } = await searchParams;

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 p-8">
      <h1 className="font-display text-5xl leading-none tracking-tight">登录没有完成</h1>
      <p className="max-w-sm text-center text-sm text-muted-foreground">
        {REASON_TEXT[reason ?? ""] ?? "登录过程中断了。"}重新登录一次即可，不会影响你的数据。
      </p>
      <span className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
        {APP_VERSION_LABEL}
      </span>
      <Button render={<Link href="/api/auth/sign-in" prefetch={false} />} size="lg">
        重新登录
      </Button>
    </div>
  );
}
