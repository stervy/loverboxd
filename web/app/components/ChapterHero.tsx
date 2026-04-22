"use client";

import { useEffect, useRef } from "react";
import type { ChapterDef } from "./Chapter";
import type { ChapterContent, ChapterId } from "../lib/chapter-data";
import { ChapterMural } from "./ChapterMural";
import { useRevealOnScroll } from "../hooks/useRevealOnScroll";

/**
 * Full-width, ~70vh chapter divider with overlaid text + poster mural + scroll
 * cue. The mural parallaxes slightly slower than the text while the hero is
 * on screen. Respects prefers-reduced-motion (via CSS in globals.css).
 */
export function ChapterHero({
  chapter,
  content,
}: {
  chapter: ChapterDef;
  content: ChapterContent;
}) {
  const heroRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRevealOnScroll<HTMLDivElement>();

  useEffect(() => {
    const hero = heroRef.current;
    if (!hero) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const mural = hero.querySelector(".parallax") as HTMLElement | null;
    if (!mural) return;

    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const rect = hero.getBoundingClientRect();
        const progress = (window.innerHeight / 2 - (rect.top + rect.height / 2)) / window.innerHeight;
        const y = Math.max(-60, Math.min(60, progress * 40));
        mural.style.setProperty("--parallax-y", `${y}px`);
        ticking = false;
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      ref={heroRef}
      className="relative w-full h-[70vh] min-h-[480px] overflow-hidden my-12 rounded-2xl border border-card-border bg-card"
    >
      <ChapterMural chapterId={chapter.id as ChapterId} posters={content.posters} />

      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-r from-card via-card/80 to-transparent pointer-events-none"
      />

      <div
        ref={titleRef}
        className="reveal-hero relative z-10 flex flex-col justify-center h-full px-10 md:px-16 max-w-3xl"
      >
        <div className="text-accent/60 font-bold text-7xl md:text-9xl leading-none tracking-tight">
          {chapter.number}
        </div>
        <h2 className="mt-2 text-5xl md:text-7xl font-bold leading-tight">
          {chapter.title}
        </h2>
        <p className="mt-6 text-lg md:text-xl text-muted max-w-xl">
          {content.subtitle}
        </p>
      </div>

      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-muted/60 text-2xl animate-bounce pointer-events-none">
        ↓
      </div>
    </div>
  );
}
