"use client";

import { useEffect, useState } from "react";

export type TocItem = { id: string; title: string };

export function SopToc({ items }: { items: TocItem[] }) {
  const [active, setActive] = useState(items[0]?.id ?? "");

  useEffect(() => {
    const headings = items
      .map((it) => document.getElementById(it.id))
      .filter((el): el is HTMLElement => el !== null);
    if (headings.length === 0) return;

    // rootMargin marks a heading current at the upper third; taking the last crossing
    // entry keeps fast scrolls from blanking the rail.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(e.target.id);
        }
      },
      { rootMargin: "-20% 0px -70% 0px", threshold: 0 },
    );
    for (const h of headings) observer.observe(h);
    return () => observer.disconnect();
  }, [items]);

  const go = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    setActive(id);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    history.replaceState(null, "", `#${id}`);
    el.setAttribute("tabindex", "-1");
    el.focus({ preventScroll: true });
  };

  if (items.length < 3) return null;

  return (
    <nav aria-label="SOP 章节" className="sop-toc">
      <p className="sop-toc-label">章节</p>
      <ul className="sop-toc-list">
        {items.map((it, i) => {
          const isActive = active === it.id;
          return (
            <li key={it.id}>
              <a
                href={`#${it.id}`}
                onClick={(e) => go(e, it.id)}
                aria-current={isActive ? "true" : undefined}
                className="sop-toc-link"
                data-active={isActive ? "" : undefined}
              >
                <span className="sop-toc-num">{i + 1}</span>
                <span className="sop-toc-text">{it.title}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
