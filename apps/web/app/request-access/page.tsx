import { signOut } from "@logto/next/server-actions";
import { redirect } from "next/navigation";

import { GooseMark } from "@/components/goose-mark";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/wordmark";
import { logtoConfig } from "@/lib/logto";
import { ensureCurrentUser } from "@/lib/users";
import { APP_VERSION_LABEL } from "@/lib/version";

import { RequestAccessForm } from "./request-access-form";

export default async function RequestAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const user = await ensureCurrentUser();
  if (!user) redirect("/api/auth/sign-in");
  if (user.accessStatus === "approved") redirect("/");
  // Compared, never rendered — a reflected message would be a phishing surface here.
  const codeFailed = (await searchParams).code === "failed";

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-8 p-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <GooseMark className="w-16" />
        <span className="text-3xl leading-none">
          <Wordmark />
        </span>
        <span className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
          {APP_VERSION_LABEL}
        </span>
      </div>
      <RequestAccessForm
        email={user.email}
        blocked={user.accessStatus === "blocked"}
        codeFailed={codeFailed}
      />
      <form
        action={async () => {
          "use server";
          await signOut(logtoConfig, new URL("/signed-out", logtoConfig.baseUrl).toString());
        }}
      >
        <Button variant="ghost" size="sm" type="submit" className="text-muted-foreground">
          退出登录 / 换个邮箱
        </Button>
      </form>
    </div>
  );
}
