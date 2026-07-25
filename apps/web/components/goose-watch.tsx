"use client";

import { useEffect, useRef } from "react";

// 注视 — geese stare. Wrap a GooseMark and its eye tracks the pointer.
//
// This is the only continuous motion on the page, so it stays cheap: one passive
// pointermove listener, coalesced to a frame, writing two CSS custom properties.
// Offsets are viewBox units (see .goose-eye), so the glance scales with the goose
// and reads the same at 64px or 200px. Reserve it for geese large enough to show
// it — on a 28px sidebar mark it is noise while someone is trying to work.
// Ramp over a short distance, not a screen-width one: scaling the offset by pointer
// proximity made the glance vanish exactly where someone looks for it, and 2.4 viewBox
// units is 1.3px at the 64px these render at. The eye is r=3.1, so ±4.5 stays in the head.
const REACH_PX = 120; // pointer distance at which the glance is fully extended
const MAX_X = 4.5;
const MAX_Y = 3.2;

export function GooseWatch({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const el = ref.current;
    if (!el) return;

    let frame = 0;
    const onMove = (e: PointerEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const r = el.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        const dist = Math.hypot(dx, dy) || 1;
        const reach = Math.min(1, dist / REACH_PX);
        el.style.setProperty("--goose-look-x", String((dx / dist) * MAX_X * reach));
        el.style.setProperty("--goose-look-y", String((dy / dist) * MAX_Y * reach));
      });
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <span ref={ref} className={className}>
      {children}
    </span>
  );
}
