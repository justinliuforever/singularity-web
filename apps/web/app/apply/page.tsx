import type { Metadata } from "next";
import Link from "next/link";

import { GooseMark } from "@/components/goose-mark";
import { Wordmark } from "@/components/wordmark";
import { APP_VERSION_LABEL } from "@/lib/version";

import { ApplyForm } from "./apply-form";

export const metadata: Metadata = {
  title: "申请内测 · 搬砖小鹅 Goooose",
  description: "填写内测申请问卷，通过后我们会与你联系。",
};

export default function ApplyPage() {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <Link href="/" className="brand-lockup flex items-center gap-2 text-xl leading-none">
          <GooseMark className="size-6 shrink-0" />
          <Wordmark />
        </Link>
        <span className="text-xs text-muted-foreground">内测申请问卷</span>
      </header>
      <main className="flex flex-1 items-start justify-center px-6 py-10 sm:items-center sm:py-6">
        <ApplyForm />
      </main>
      <footer className="flex items-center justify-center gap-3 px-6 pb-8 text-xs text-muted-foreground">
        <span>© 2026 搬砖小鹅 Goooose</span>
        <span className="font-mono text-[10px] tracking-widest uppercase">{APP_VERSION_LABEL}</span>
      </footer>
    </div>
  );
}
