"use client";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function SpotlightCard({
  className,
  children,
  ...props
}: React.ComponentProps<typeof Card>) {
  return (
    <Card
      onMouseMove={(e) => {
        const el = e.currentTarget;
        const r = el.getBoundingClientRect();
        el.style.setProperty("--spot-x", `${e.clientX - r.left}px`);
        el.style.setProperty("--spot-y", `${e.clientY - r.top}px`);
      }}
      className={cn("relative", className)}
      {...props}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover/card:opacity-100 motion-reduce:hidden"
        style={{
          background:
            "radial-gradient(180px circle at var(--spot-x, 50%) var(--spot-y, 50%), color-mix(in oklab, var(--foreground) 6%, transparent), transparent 70%)",
        }}
      />
      {children}
    </Card>
  );
}
