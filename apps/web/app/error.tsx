"use client";

import { Button } from "@/components/ui/button";
import { APP_VERSION_LABEL } from "@/lib/version";

// instrumentation.ts:onRequestError already records the server side; this only decides what the
// person looking at the blank page sees. digest is the only handle support can correlate on.
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 p-8">
      <h1 className="font-display text-5xl leading-none tracking-tight">这个页面出错了</h1>
      <p className="max-w-sm text-center text-sm text-muted-foreground">
        刷新一次通常就好。如果反复出现，把下面这行编号发给我们，我们能直接定位。
      </p>
      <span className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
        {APP_VERSION_LABEL}
        {error.digest ? ` · ${error.digest}` : ""}
      </span>
      <Button onClick={reset} size="lg">
        重试
      </Button>
    </div>
  );
}
