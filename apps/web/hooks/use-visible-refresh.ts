"use client";

import { useCallback, useEffect, useRef } from "react";

// Refreshing the server tree for a hidden tab costs a full RSC render nobody is looking at,
// and SSE keeps delivering progress while hidden. Requests made while hidden collapse into a
// single flush on return; the interval is a staleness floor, not the primary trigger.
export function useVisibleRefresh(onRefresh: () => void, fallbackMs = 60_000) {
  const latest = useRef(onRefresh);
  const pending = useRef(false);
  useEffect(() => {
    latest.current = onRefresh;
  });

  const request = useCallback(() => {
    if (typeof document === "undefined" || document.visibilityState === "visible") {
      latest.current();
    } else {
      pending.current = true;
    }
  }, []);

  useEffect(() => {
    const flush = () => {
      if (document.visibilityState !== "visible" || !pending.current) return;
      pending.current = false;
      latest.current();
    };
    document.addEventListener("visibilitychange", flush);
    const id = setInterval(() => {
      if (document.visibilityState === "visible") latest.current();
    }, fallbackMs);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      clearInterval(id);
    };
  }, [fallbackMs]);

  return request;
}
