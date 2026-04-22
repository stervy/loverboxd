"use client";

import { useEffect, useState } from "react";
import type { ChapterDef } from "./Chapter";

/**
 * Sticky top pill bar that appears after scrolling past the intro.
 * Tracks which chapter is in view via IntersectionObserver on
 * [data-chapter] elements. Click = smooth scroll to that chapter.
 */
export function StickyNav({ chapters }: { chapters: ChapterDef[] }) {
  const [active, setActive] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const sections = chapters
      .map((c) => document.querySelector(`[data-chapter="${c.id}"]`))
      .filter((el): el is Element => el != null);
    if (sections.length === 0) return;

    const visibility = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.chapter;
          if (id) visibility.set(id, entry.intersectionRatio);
        }
        let best: string | null = null;
        let bestRatio = 0;
        for (const [id, ratio] of visibility) {
          if (ratio > bestRatio) {
            best = id;
            bestRatio = ratio;
          }
        }
        if (best) setActive(best);
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1] }
    );
    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, [chapters]);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 500);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const jumpTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <nav
      aria-label="Dashboard chapters"
      className={`fixed top-0 left-0 right-0 z-40 transition-opacity duration-300 ${
        visible ? "opacity-100" : "opacity-0 pointer-events-none"
      }`}
    >
      <div className="bg-background/80 backdrop-blur-md border-b border-card-border">
        <div className="max-w-6xl mx-auto px-4 py-3 flex gap-2 overflow-x-auto">
          {chapters.map((c) => (
            <button
              key={c.id}
              onClick={() => jumpTo(c.id)}
              className={`flex-shrink-0 text-sm px-3 py-1.5 rounded-full border transition-colors ${
                active === c.id
                  ? "bg-accent text-background border-accent font-semibold"
                  : "border-card-border text-muted hover:text-foreground hover:border-muted"
              }`}
            >
              <span className="opacity-60 mr-1.5">{c.number}</span>
              {c.title}
            </button>
          ))}
        </div>
      </div>
    </nav>
  );
}
