"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

type Props = {
  redirectTo: string;
  duration?: number;
};

export function Splash({ redirectTo, duration = 1500 }: Props) {
  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => {
      router.replace(redirectTo);
    }, duration);
    return () => clearTimeout(timer);
  }, [router, redirectTo, duration]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
      <svg
        className="pointer-events-none absolute top-12 left-12 opacity-10"
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
        className="pointer-events-none absolute right-12 bottom-12 scale-x-[-1] opacity-10"
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

      <div className="relative flex flex-col items-center gap-12">
        <h1 className="font-brand text-6xl leading-none select-none sm:text-7xl">
          搬砖小鹅 <span className="font-display italic">Goooose</span>
        </h1>
        <p className="-mt-8 text-sm tracking-wide text-muted-foreground select-none">
          看对标 → 出选题 → 写稿
        </p>
        <svg
          viewBox="0 0 200 100"
          className="w-56 overflow-visible sm:w-64"
          fill="none"
          aria-hidden
        >
          <path
            className="splash-line splash-line-clerk"
            d="M10,80 C40,80 60,20 100,50 C140,80 160,20 190,20"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <path
            className="splash-line splash-line-muse"
            d="M10,20 C40,20 60,80 100,50 C140,20 160,80 190,80"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <path
            className="splash-line splash-line-poet"
            d="M10,50 C50,10 150,90 190,50"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </svg>
        <div className="flex gap-2">
          <span className="splash-dot splash-dot-1 size-2 rounded-full bg-clerk" />
          <span className="splash-dot splash-dot-2 size-2 rounded-full bg-muse" />
          <span className="splash-dot splash-dot-3 size-2 rounded-full bg-poet" />
        </div>
      </div>
    </div>
  );
}
