import Link from "next/link";

import { GooseMark } from "@/components/goose-mark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/wordmark";
import { APP_VERSION_LABEL } from "@/lib/version";

import { BetaCta } from "./beta-cta";

const MODULES = [
  {
    name: "操盘小鹅 · 看对标",
    dot: "bg-clerk",
    desc: "拆解对标频道与爆款视频，沉淀成可复用的创作 SOP",
  },
  {
    name: "灵感小鹅 · 出选题",
    dot: "bg-muse",
    desc: "监控你的对标账号，从最新爆款里生成贴合定位的选题",
  },
  {
    name: "神笔小鹅 · 写稿",
    dot: "bg-poet",
    desc: "基于你的人设圣经与选题，产出可直接开拍的口播稿",
  },
];

export default function LandingPage() {
  return (
    <div className="relative flex min-h-svh flex-col overflow-hidden bg-background">
      <svg
        className="pointer-events-none absolute top-16 left-10 opacity-10 sm:left-16"
        width="100"
        height="60"
        viewBox="0 0 100 60"
        fill="none"
        aria-hidden
      >
        <path
          d="M10 40C10 30 20 20 35 20C40 10 60 10 70 20C85 20 95 30 95 45C95 55 85 60 75 60H25C15 60 10 50 10 40Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="4 2"
        />
      </svg>
      <svg
        className="pointer-events-none absolute right-10 bottom-24 scale-x-[-1] opacity-10 sm:right-16"
        width="120"
        height="70"
        viewBox="0 0 100 60"
        fill="none"
        aria-hidden
      >
        <path
          d="M10 40C10 30 20 20 35 20C40 10 60 10 70 20C85 20 95 30 95 45C95 55 85 60 75 60H25C15 60 10 50 10 40Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="3 3"
        />
      </svg>

      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <span className="flex items-center gap-2 text-xl leading-none">
          <GooseMark className="size-6 shrink-0" />
          <Wordmark />
        </span>
        <Button render={<Link href="/api/auth/sign-in" prefetch={false} />} variant="ghost" size="sm">
          登录
        </Button>
      </header>

      <main className="relative flex flex-1 flex-col items-center justify-center gap-12 px-6 py-16 text-center">
        <div className="flex flex-col items-center gap-5">
          <Badge variant="outline" className="gap-1.5 rounded-full px-3 py-1 text-xs">
            <span className="size-1.5 animate-pulse rounded-full bg-poet" />
            内测招募中
          </Badge>
          <h1 className="text-5xl leading-tight sm:text-7xl">
            <Wordmark />
          </h1>
          <p className="text-base tracking-wide text-muted-foreground sm:text-lg">
            AI 内容教练 · 看对标 → 出选题 → 写稿
          </p>
        </div>

        {/* The crew, in their own colors: 操盘 / 灵感 / 神笔 */}
        <div className="flex items-end justify-center gap-6 sm:gap-10">
          <GooseMark tone="clerk" className="splash-goose splash-goose-1 w-16 sm:w-20" />
          <GooseMark tone="muse" className="splash-goose splash-goose-2 w-16 sm:w-20" />
          <GooseMark tone="poet" className="splash-goose splash-goose-3 w-16 sm:w-20" />
        </div>

        <div className="grid w-full max-w-3xl gap-4 text-left sm:grid-cols-3">
          {MODULES.map((m) => (
            <div key={m.name} className="rounded-lg border bg-card p-5">
              <div className="flex items-center gap-2">
                <span className={`size-2 rounded-full ${m.dot}`} />
                <h2 className="text-sm font-medium">{m.name}</h2>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{m.desc}</p>
            </div>
          ))}
        </div>

        <BetaCta />
      </main>

      <footer className="flex items-center justify-center gap-3 px-6 pb-8 text-xs text-muted-foreground">
        <span>© 2026 搬砖小鹅 Goooose</span>
        <span className="font-mono text-[10px] tracking-widest uppercase">{APP_VERSION_LABEL}</span>
      </footer>
    </div>
  );
}
