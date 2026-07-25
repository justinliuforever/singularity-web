"use client";

import NumberFlow from "@number-flow/react";
import { useEffect, useState } from "react";

type Props = {
  value: number;
  // Roll up from 0 on mount; without it only later value changes animate.
  countUp?: boolean;
  className?: string;
};

export function AnimatedNumber({ value, countUp = false, className }: Props) {
  const [display, setDisplay] = useState(countUp ? 0 : value);
  useEffect(() => {
    // Without the rAF the browser never paints the previous value, so NumberFlow
    // has no transition to animate.
    const raf = requestAnimationFrame(() => setDisplay(value));
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return (
    <NumberFlow value={display} className={className} format={{ useGrouping: false }} />
  );
}
