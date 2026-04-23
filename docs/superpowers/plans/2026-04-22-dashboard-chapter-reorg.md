# Dashboard Chapter Reorg — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the flat 6000px dashboard scroll into a chaptered journey — 6 thematic chapters with hero dividers, sticky nav, scroll-triggered motion, poster ribbons, restricted accent color, and the Power Duos self-pair bug fixed.

**Architecture:** Additive wrappers around existing JSX, not a rewrite. Five new components (`Chapter`, `ChapterHero`, `StickyNav`, `PosterRibbon`, plus two hooks) live in `web/app/components/`. The dashboard's `StatsView` JSX is re-ordered so all sections for a given chapter are contiguous; a `<ChapterHero>` is placed at each chapter boundary; `<StickyNav>` is rendered once at the top of `StatsView`. Motion is added by attaching `useRevealOnScroll` refs to existing charts/cards and a `useCountUp` hook on hero numbers.

**Tech Stack:** Next.js 16 (App Router, client components), React 19, TypeScript, Tailwind CSS 4. No new npm dependencies — motion uses vanilla IntersectionObserver + CSS transitions.

**Context for the engineer:**
- Dashboard code lives in a single file: `web/app/dashboard.tsx` (~3365 lines). Don't try to split it — scope creep.
- There is **no test framework** in this project (package.json has no jest/vitest/testing-library). Verification is visual: run `npm run dev` in `web/` and check the browser.
- Poster data comes from TMDB via already-populated `filmDetails` entries. Use `tmdbImg(path, size)` (already defined in `dashboard.tsx`) to build image URLs.
- The spec is at `docs/superpowers/specs/2026-04-21-dashboard-chapter-reorg-design.md`. Re-read it if you lose context.

**Key current line numbers in `dashboard.tsx` (may shift as you edit — re-grep before relying on them):**
| Section | ~Line |
|---|---|
| `StatsView` fn starts | 903 |
| Profile Header | 1743 |
| Top Stats Row | 1793 |
| CSV Upload banners | 1837 |
| Rating Distribution | 2022 |
| No-ratings notice | 2039 |
| "Top 3" row (Directors/Genres/Actors) | 2054 |
| Enrichment Progress Bar | 2100 |
| Insights Section wrapper | 2118 |
| Top Genre Combinations | 2121 |
| Top Themes | 2150 |
| Popularity + Likeability | 2216 |
| User vs Crowd | 2334 |
| Cinematic Age + Power Duos row | 2469 |
| Genre Taste Profile | 2597 |
| Highest-Rated People | 2613 |
| 5-Star Club + Runtime Stats | 2707 |
| Country Explorer | 2863 |
| Films by Decade | 2886 |
| Top Rated Films | 2904 |
| Recent Activity | 2935 |
| Find Your Match | 2973 |
| Power Duos computation | 1144–1165 |

---

## File Structure

**New files:**
- `web/app/components/Chapter.tsx` — wrapper that gives each chapter a stable DOM id + section anchor
- `web/app/components/ChapterHero.tsx` — the 70vh hero divider with number/title/subtitle/mural
- `web/app/components/ChapterMural.tsx` — the poster-mural renderer (each chapter variant)
- `web/app/components/StickyNav.tsx` — top pill bar with IntersectionObserver tracking
- `web/app/components/PosterRibbon.tsx` — thin decorative 3–5-poster strip
- `web/app/components/RevealOnScroll.tsx` — wrapper component that applies reveal animation
- `web/app/hooks/useRevealOnScroll.ts` — IntersectionObserver hook (reveal-once)
- `web/app/hooks/useCountUp.ts` — number count-up hook (respects reduced-motion)
- `web/app/lib/chapter-data.ts` — derives per-chapter subtitle + mural inputs from `stats`/`filmDetails`

**Modified files:**
- `web/app/dashboard.tsx` — reorder JSX into chapter groupings, insert ChapterHero/PosterRibbon/StickyNav, attach reveal refs to charts, fix Power Duos self-pair, restrict accent-green usage
- `web/app/globals.css` — add keyframes/utility classes for motion, add `prefers-reduced-motion` guard

---

## Verification approach (substitute for TDD)

This project has no test framework. Each task verifies via the dev server + a browser screenshot rather than a failing-test-first cycle.

**Dev server command** (run from `web/`):
```bash
npm run dev
```
Open `http://localhost:3000/` and click the "or see a demo profile" link to load the demo user's dashboard.

**Screenshot verification pattern** used across tasks:
1. Run dev server (kept running between tasks).
2. In the browser, navigate to `http://localhost:3000/`, click "or see a demo profile".
3. Wait for dashboard to load (~3–5s).
4. Take a screenshot / scroll and eyeball the change.
5. Only then commit.

If the engineer has access to the Chrome MCP (`mcp__Claude_in_Chrome__*` tools), use `navigate` + `computer:screenshot` to automate.

---

## Task 1: Add motion primitives to globals.css

**Files:**
- Modify: `web/app/globals.css`

- [ ] **Step 1: Append reveal animation utilities to `globals.css`**

Append the following to the end of `web/app/globals.css`:

```css
/* === Reveal-on-scroll primitives === */

/* Hidden state: target will become visible when `.revealed` is added. */
.reveal {
  opacity: 0;
  transform: translateY(12px);
  transition: opacity 600ms ease-out, transform 600ms ease-out;
  will-change: opacity, transform;
}

.reveal.revealed {
  opacity: 1;
  transform: translateY(0);
}

/* Bar growth (scaled horizontally from the left). Use on chart bar elements. */
.reveal-bar {
  transform-origin: left center;
  transform: scaleX(0);
  transition: transform 700ms cubic-bezier(0.2, 0.8, 0.2, 1);
  will-change: transform;
}

.reveal-bar.revealed {
  transform: scaleX(1);
}

/* Pie / map: fade + subtle scale. */
.reveal-scale {
  opacity: 0;
  transform: scale(0.92);
  transition: opacity 600ms ease-out, transform 600ms ease-out;
  will-change: opacity, transform;
}

.reveal-scale.revealed {
  opacity: 1;
  transform: scale(1);
}

/* Poster fade + rise. */
.reveal-poster {
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 500ms ease-out, transform 500ms ease-out;
}

.reveal-poster.revealed {
  opacity: 1;
  transform: translateY(0);
}

/* Chapter hero typography slide. */
.reveal-hero {
  opacity: 0;
  transform: translateY(24px);
  transition: opacity 800ms ease-out, transform 800ms ease-out;
}

.reveal-hero.revealed {
  opacity: 1;
  transform: translateY(0);
}

/* Parallax layer — position adjusted via CSS custom property set by JS. */
.parallax {
  transform: translate3d(0, var(--parallax-y, 0px), 0);
  will-change: transform;
}

/* Reduced-motion: skip every animation, render final state immediately. */
@media (prefers-reduced-motion: reduce) {
  .reveal,
  .reveal-bar,
  .reveal-scale,
  .reveal-poster,
  .reveal-hero {
    opacity: 1 !important;
    transform: none !important;
    transition: none !important;
  }
  .parallax {
    transform: none !important;
  }
}
```

- [ ] **Step 2: Verify build compiles**

Run from `web/`:
```bash
npm run build
```
Expected: build succeeds (or matches its pre-change state — record any pre-existing warnings before step 1 so you don't misattribute them).

- [ ] **Step 3: Commit**

```bash
git add web/app/globals.css
git commit -m "Add reveal/parallax CSS primitives for dashboard motion"
```

---

## Task 2: `useRevealOnScroll` hook

**Files:**
- Create: `web/app/hooks/useRevealOnScroll.ts`

- [ ] **Step 1: Create the hook**

Create `web/app/hooks/useRevealOnScroll.ts` with the exact contents:

```tsx
"use client";

import { useEffect, useRef } from "react";

/**
 * Attach to any element you want to animate in once when it enters the viewport.
 *
 * Usage:
 *   const ref = useRevealOnScroll<HTMLDivElement>();
 *   <div ref={ref} className="reveal">...</div>
 *
 * The hook toggles the `revealed` class on the element once it has intersected
 * the viewport, then unsubscribes — so the animation plays once per page load.
 *
 * Opts:
 *   - threshold: IntersectionObserver threshold (default 0.15)
 *   - rootMargin: IntersectionObserver rootMargin (default "0px 0px -10% 0px"
 *     — fires a touch before the element is fully visible, which feels livelier)
 */
export function useRevealOnScroll<T extends HTMLElement>(opts?: {
  threshold?: number;
  rootMargin?: string;
}) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // If the user prefers reduced motion, immediately show and do nothing.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.classList.add("revealed");
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            el.classList.add("revealed");
            observer.unobserve(el);
          }
        }
      },
      {
        threshold: opts?.threshold ?? 0.15,
        rootMargin: opts?.rootMargin ?? "0px 0px -10% 0px",
      }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [opts?.threshold, opts?.rootMargin]);

  return ref;
}
```

- [ ] **Step 2: Commit**

```bash
git add web/app/hooks/useRevealOnScroll.ts
git commit -m "Add useRevealOnScroll hook"
```

---

## Task 3: `useCountUp` hook

**Files:**
- Create: `web/app/hooks/useCountUp.ts`

- [ ] **Step 1: Create the hook**

Create `web/app/hooks/useCountUp.ts`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Returns a number that animates from 0 to `target` once the ref'd element
 * first enters the viewport. Respects `prefers-reduced-motion`.
 *
 * Example:
 *   const { ref, value } = useCountUp(772, { durationMs: 800 });
 *   <span ref={ref}>{value}</span>
 *
 * For decimals (e.g. avg rating 3.38), pass `decimals`.
 */
export function useCountUp(
  target: number,
  opts?: { durationMs?: number; decimals?: number }
) {
  const ref = useRef<HTMLElement | null>(null);
  const [value, setValue] = useState(0);
  const startedRef = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Reduced motion: jump to final value immediately.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setValue(target);
      return;
    }

    const duration = opts?.durationMs ?? 800;

    const start = () => {
      if (startedRef.current) return;
      startedRef.current = true;
      const startTs = performance.now();
      const step = (now: number) => {
        const elapsed = now - startTs;
        const t = Math.min(elapsed / duration, 1);
        // Ease-out cubic.
        const eased = 1 - Math.pow(1 - t, 3);
        setValue(target * eased);
        if (t < 1) requestAnimationFrame(step);
        else setValue(target);
      };
      requestAnimationFrame(step);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            start();
            observer.unobserve(el);
          }
        }
      },
      { threshold: 0.2 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [target, opts?.durationMs]);

  const formatted =
    opts?.decimals != null
      ? value.toFixed(opts.decimals)
      : Math.round(value).toString();

  return { ref, value, formatted };
}
```

- [ ] **Step 2: Commit**

```bash
git add web/app/hooks/useCountUp.ts
git commit -m "Add useCountUp hook"
```

---

## Task 4: Fix Power Duos self-pair bug

**Files:**
- Modify: `web/app/dashboard.tsx:1144-1165`

- [ ] **Step 1: Re-grep to confirm line numbers**

```bash
grep -n "Director-Actor Power Duos" web/app/dashboard.tsx
```

Find the `const powerDuos = useMemo(...)` block that starts at the line returned and ends at the closing `}, [filmDetails]);`.

- [ ] **Step 2: Edit the inner loops to skip self-pairs**

Find this block:

```tsx
  const powerDuos = useMemo(() => {
    const pairSlugs = new Map<string, string[]>();
    for (const film of filmDetails) {
      for (const dir of film.directors) {
        for (const act of film.actors) {
          const key = `${dir}|||${act}`;
          const existing = pairSlugs.get(key);
          if (existing) existing.push(film.slug);
          else pairSlugs.set(key, [film.slug]);
        }
      }
    }
```

Replace with:

```tsx
  const powerDuos = useMemo(() => {
    const pairSlugs = new Map<string, string[]>();
    for (const film of filmDetails) {
      for (const dir of film.directors) {
        for (const act of film.actors) {
          // Skip self-pairs (same person credited as both director and actor
          // on the same film) — "Tarantino + Tarantino" isn't a duo.
          if (dir === act) continue;
          const key = `${dir}|||${act}`;
          const existing = pairSlugs.get(key);
          if (existing) existing.push(film.slug);
          else pairSlugs.set(key, [film.slug]);
        }
      }
    }
```

- [ ] **Step 3: Verify visually**

Start dev server: `cd web && npm run dev` (leave running in background).
Open `http://localhost:3000/`, click "or see a demo profile", scroll to the Power Duos card.
Expected: no duo has the same name twice (previously "Quentin Tarantino + Quentin Tar…" appeared).

- [ ] **Step 4: Commit**

```bash
git add web/app/dashboard.tsx
git commit -m "Filter self-pairs out of Power Duos"
```

---

## Task 5: `Chapter` wrapper component

**Files:**
- Create: `web/app/components/Chapter.tsx`

This component produces a `<section>` with a stable `id` (for nav anchors) and a `data-chapter` attribute used by StickyNav's IntersectionObserver.

- [ ] **Step 1: Create the component**

Create `web/app/components/Chapter.tsx`:

```tsx
"use client";

import { ReactNode } from "react";

export interface ChapterDef {
  id: string;          // stable anchor id, e.g. "ch-1"
  number: string;      // "01"
  title: string;       // "How You Rate"
}

/**
 * Chapter is a pure structural wrapper: `<section id={id} data-chapter={id}>`.
 * The ChapterHero and the chapter body are placed inside it as children.
 * StickyNav tracks which chapter is in view via the `data-chapter` attribute.
 */
export function Chapter({
  chapter,
  children,
}: {
  chapter: ChapterDef;
  children: ReactNode;
}) {
  return (
    <section id={chapter.id} data-chapter={chapter.id} className="scroll-mt-16">
      {children}
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/app/components/Chapter.tsx
git commit -m "Add Chapter wrapper component"
```

---

## Task 6: `chapter-data.ts` — derive subtitles and mural inputs

**Files:**
- Create: `web/app/lib/chapter-data.ts`

This module is pure functions. It reads the stats + filmDetails that `StatsView` already computes and returns the per-chapter subtitle and mural poster paths.

- [ ] **Step 1: Create the module**

Create `web/app/lib/chapter-data.ts`:

```ts
/**
 * Per-chapter content derived from stats + filmDetails.
 * Pure functions — no React. Called once from StatsView and the result is
 * threaded into each ChapterHero.
 *
 * Subtitles use data the dashboard already computes; if inputs are missing
 * we fall back to a plain tagline so the hero still renders.
 */

import type { ChapterDef } from "../components/Chapter";

export const CHAPTERS: ChapterDef[] = [
  { id: "ch-1", number: "01", title: "How You Rate" },
  { id: "ch-2", number: "02", title: "Your People" },
  { id: "ch-3", number: "03", title: "Your Taste" },
  { id: "ch-4", number: "04", title: "Scale & Reach" },
  { id: "ch-5", number: "05", title: "Your Films" },
  { id: "ch-6", number: "06", title: "Find Your Match" },
];

export type ChapterId = (typeof CHAPTERS)[number]["id"];

export interface ChapterContent {
  subtitle: string;
  posters: string[]; // TMDB poster paths (not URLs)
}

export interface ChapterInputs {
  totalRated: number;
  p25Stars: number;
  p75Stars: number;
  topDirectorName: string | null;
  topDirectorFilmCount: number;
  topGenreName: string | null;
  topGenrePercent: number;
  hoursWatched: number;
  countryCount: number;
  topRatedCount: number;
  recentCount: number;
  fiveStarPosters: string[];
  topDirectorPosters: string[];
  topGenrePosters: string[];
  longestFilmPoster: string | null;
  topRatedPosters: string[];
}

/** Return content for every chapter, in order. */
export function buildChapterContent(inputs: ChapterInputs): Record<ChapterId, ChapterContent> {
  return {
    "ch-1": {
      subtitle:
        inputs.totalRated > 0
          ? `You've rated ${inputs.totalRated} films, and you mostly land between ${inputs.p25Stars} and ${inputs.p75Stars} stars.`
          : "The way you score.",
      posters: inputs.fiveStarPosters.slice(0, 6),
    },
    "ch-2": {
      subtitle:
        inputs.topDirectorName
          ? `${inputs.topDirectorName} tops your list — you've watched ${inputs.topDirectorFilmCount} of their films.`
          : "The people you keep coming back to.",
      posters: inputs.topDirectorPosters.slice(0, 5),
    },
    "ch-3": {
      subtitle:
        inputs.topGenreName
          ? `${inputs.topGenreName} leads your taste, at ${inputs.topGenrePercent}% of what you watch.`
          : "What you actually watch.",
      posters: inputs.topGenrePosters.slice(0, 9),
    },
    "ch-4": {
      subtitle:
        inputs.hoursWatched > 0
          ? `${inputs.hoursWatched} hours across ${inputs.countryCount} countries.`
          : "The scope of your watching.",
      posters: inputs.longestFilmPoster ? [inputs.longestFilmPoster] : [],
    },
    "ch-5": {
      subtitle: `Your top ${inputs.topRatedCount} films, and your last ${inputs.recentCount} watches.`,
      posters: inputs.topRatedPosters.slice(0, 5),
    },
    "ch-6": {
      subtitle: "See how your taste lines up with a friend.",
      posters: [],
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add web/app/lib/chapter-data.ts
git commit -m "Add chapter-data module for subtitles and mural inputs"
```

---

## Task 7: `ChapterMural` component

**Files:**
- Create: `web/app/components/ChapterMural.tsx`

- [ ] **Step 1: Create the component**

Create `web/app/components/ChapterMural.tsx`:

```tsx
"use client";

import Image from "next/image";
import type { ChapterId } from "../lib/chapter-data";

function tmdbPosterUrl(path: string, size: "w185" | "w342" = "w342"): string {
  return `https://image.tmdb.org/t/p/${size}${path}`;
}

/**
 * Renders a contextual poster mural per chapter. Layouts vary by chapter to
 * reinforce its theme (cascading stack, fan, mosaic, etc.). All murals are
 * absolutely positioned so the ChapterHero overlays text on top.
 */
export function ChapterMural({
  chapterId,
  posters,
}: {
  chapterId: ChapterId;
  posters: string[];
}) {
  if (posters.length === 0) {
    // Fallback: geometric accent backdrop.
    return (
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-br from-accent/10 via-transparent to-accent/5 pointer-events-none"
      />
    );
  }

  switch (chapterId) {
    case "ch-1":
      // Cascading diagonal of 5-star posters.
      return (
        <div aria-hidden className="absolute inset-0 overflow-hidden pointer-events-none parallax">
          {posters.slice(0, 6).map((p, i) => (
            <div
              key={p}
              className="absolute w-40 h-60 rounded-md shadow-2xl"
              style={{
                right: `${4 + i * 6}%`,
                top: `${8 + i * 8}%`,
                transform: `rotate(${-6 + i * 2}deg)`,
                opacity: 0.55 - i * 0.05,
              }}
            >
              <Image
                src={tmdbPosterUrl(p)}
                alt=""
                fill
                sizes="160px"
                className="object-cover rounded-md"
              />
            </div>
          ))}
        </div>
      );

    case "ch-2":
      // Fanned stack of top director's filmography.
      return (
        <div aria-hidden className="absolute inset-0 overflow-hidden pointer-events-none parallax">
          {posters.slice(0, 5).map((p, i) => (
            <div
              key={p}
              className="absolute w-44 h-64 rounded-md shadow-2xl"
              style={{
                right: `${10 + i * 4}%`,
                top: "15%",
                transform: `rotate(${-12 + i * 6}deg)`,
                opacity: 0.5,
                zIndex: 5 - i,
              }}
            >
              <Image src={tmdbPosterUrl(p)} alt="" fill sizes="176px" className="object-cover rounded-md" />
            </div>
          ))}
        </div>
      );

    case "ch-3":
      // Mosaic of posters from top genres.
      return (
        <div aria-hidden className="absolute inset-0 overflow-hidden pointer-events-none parallax">
          <div className="absolute right-0 top-0 bottom-0 w-2/3 grid grid-cols-3 gap-2 p-4 opacity-50">
            {posters.slice(0, 9).map((p) => (
              <div key={p} className="relative aspect-[2/3] rounded-md overflow-hidden">
                <Image src={tmdbPosterUrl(p, "w185")} alt="" fill sizes="120px" className="object-cover" />
              </div>
            ))}
          </div>
        </div>
      );

    case "ch-4":
      // Single hero poster on the right (longest film).
      return (
        <div aria-hidden className="absolute inset-0 overflow-hidden pointer-events-none parallax">
          <div
            className="absolute right-[8%] top-[10%] w-64 h-96 rounded-lg shadow-2xl"
            style={{ opacity: 0.5 }}
          >
            <Image src={tmdbPosterUrl(posters[0])} alt="" fill sizes="256px" className="object-cover rounded-lg" />
          </div>
        </div>
      );

    case "ch-5":
      // Cinematic stack of top-rated posters.
      return (
        <div aria-hidden className="absolute inset-0 overflow-hidden pointer-events-none parallax">
          {posters.slice(0, 5).map((p, i) => (
            <div
              key={p}
              className="absolute w-48 h-72 rounded-md shadow-2xl"
              style={{
                right: `${6 + i * 5}%`,
                top: `${10 + (i % 2) * 6}%`,
                transform: `rotate(${-4 + i * 2}deg)`,
                opacity: 0.55 - i * 0.04,
                zIndex: 5 - i,
              }}
            >
              <Image src={tmdbPosterUrl(p)} alt="" fill sizes="192px" className="object-cover rounded-md" />
            </div>
          ))}
        </div>
      );

    case "ch-6":
      // No mural (keep this chapter visually quiet — it's the CTA).
      return (
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-br from-accent/5 to-transparent pointer-events-none"
        />
      );

    default:
      return null;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add web/app/components/ChapterMural.tsx
git commit -m "Add ChapterMural component"
```

---

## Task 8: `ChapterHero` component (with parallax)

**Files:**
- Create: `web/app/components/ChapterHero.tsx`

- [ ] **Step 1: Create the component**

Create `web/app/components/ChapterHero.tsx`:

```tsx
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

  // Parallax: translate the mural a fraction of scroll progress through the
  // hero. Uses a rAF loop scoped to whenever the hero is in viewport.
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
        // Progress from -1 (hero below viewport) to +1 (hero above viewport).
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

      {/* Subtle gradient scrim so text remains readable over posters. */}
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-r from-card via-card/80 to-transparent pointer-events-none"
      />

      <div ref={titleRef} className="reveal-hero relative z-10 flex flex-col justify-center h-full px-10 md:px-16 max-w-3xl">
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

      {/* Scroll cue. */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-muted/60 text-2xl animate-bounce pointer-events-none">
        ↓
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify import paths compile**

```bash
cd web && npm run build
```
Expected: build succeeds. If it fails on the `ChapterDef` import or similar, fix the path.

- [ ] **Step 3: Commit**

```bash
git add web/app/components/ChapterHero.tsx
git commit -m "Add ChapterHero component with parallax mural"
```

---

## Task 9: `PosterRibbon` component

**Files:**
- Create: `web/app/components/PosterRibbon.tsx`

- [ ] **Step 1: Create the component**

Create `web/app/components/PosterRibbon.tsx`:

```tsx
"use client";

import Image from "next/image";
import { useRevealOnScroll } from "../hooks/useRevealOnScroll";

function tmdbPosterUrl(path: string, size: "w185" = "w185"): string {
  return `https://image.tmdb.org/t/p/${size}${path}`;
}

/**
 * Thin decorative strip of 3–5 posters used between chart-heavy sections
 * inside a chapter. Purely visual rhythm — no interaction, no labels.
 * If the caller passes 0 posters, renders nothing.
 */
export function PosterRibbon({ posters }: { posters: string[] }) {
  const ref = useRevealOnScroll<HTMLDivElement>();

  if (posters.length === 0) return null;

  return (
    <div
      ref={ref}
      aria-hidden
      className="reveal flex gap-3 overflow-hidden py-4 my-4 opacity-80"
    >
      {posters.slice(0, 5).map((p) => (
        <div key={p} className="relative flex-shrink-0 w-20 h-30 md:w-24 md:h-36 rounded-md overflow-hidden">
          <Image
            src={tmdbPosterUrl(p)}
            alt=""
            fill
            sizes="96px"
            className="object-cover"
          />
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/app/components/PosterRibbon.tsx
git commit -m "Add PosterRibbon component"
```

---

## Task 10: `StickyNav` component

**Files:**
- Create: `web/app/components/StickyNav.tsx`

- [ ] **Step 1: Create the component**

Create `web/app/components/StickyNav.tsx`:

```tsx
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

  // Observe each chapter section — the one most in view wins.
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

  // Hide the nav until the user has scrolled past the intro (~500px is
  // enough to clear the profile + stats row on desktop and on mobile).
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
```

- [ ] **Step 2: Commit**

```bash
git add web/app/components/StickyNav.tsx
git commit -m "Add StickyNav component"
```

---

## Task 11: Wire chapter content inputs in `StatsView`

Before reordering JSX, add the bookkeeping that feeds `ChapterHero`: compute the inputs for each chapter's subtitle + mural.

**Files:**
- Modify: `web/app/dashboard.tsx` (inside `StatsView`, near the other `useMemo` blocks around line 1167+ — place after `genreTaste` so all needed vars are in scope).

- [ ] **Step 1: Re-grep to find insertion point**

```bash
grep -n "genreTaste" web/app/dashboard.tsx
```
Find the end of the `genreTaste` useMemo (looks like `}, [filmDetails, ratingBySlug]);`). Insert the new block right after that line.

- [ ] **Step 2: Add imports at the top of dashboard.tsx**

Near the existing `import { type CSVFilm, extractRatingsFromFile } from "./csv-utils";` line, add:

```tsx
import { Chapter } from "./components/Chapter";
import { ChapterHero } from "./components/ChapterHero";
import { PosterRibbon } from "./components/PosterRibbon";
import { StickyNav } from "./components/StickyNav";
import { CHAPTERS, buildChapterContent } from "./lib/chapter-data";
```

- [ ] **Step 3: Add a `chapterContent` useMemo inside `StatsView`**

Insert after the `genreTaste` useMemo block:

```tsx
  // Derive content (subtitle + mural poster paths) for each chapter hero.
  // Pulls from already-computed stats and filmDetails, so no new data work.
  const chapterContent = useMemo(() => {
    const posterBySlug = new Map<string, string>();
    for (const f of filmDetails) {
      if (f.posterPath) posterBySlug.set(f.slug, f.posterPath);
    }

    // Ch 1: 5-star film posters.
    const fiveStarPosters: string[] = [];
    for (const [slug, rating] of ratingBySlug) {
      if (rating >= 5) {
        const p = posterBySlug.get(slug);
        if (p) fiveStarPosters.push(p);
      }
    }

    // p25 / p75 of ratings (for Ch 1 subtitle).
    const ratings = [...ratingBySlug.values()].sort((a, b) => a - b);
    const p25Stars = ratings.length ? ratings[Math.floor(ratings.length * 0.25)] : 0;
    const p75Stars = ratings.length ? ratings[Math.floor(ratings.length * 0.75)] : 0;

    // Ch 2: top director's posters.
    // NOTE: topDirectors is a tuple array — entries are [name, count], not
    // objects. So `topDirectors[0][0]` is the name, `[0][1]` is the count.
    const topDirectorName = topDirectors[0]?.[0] ?? null;
    const topDirectorFilmCount = topDirectors[0]?.[1] ?? 0;
    const topDirectorPosters: string[] = [];
    if (topDirectorName) {
      for (const f of filmDetails) {
        if (f.directors.includes(topDirectorName) && f.posterPath) {
          topDirectorPosters.push(f.posterPath);
        }
      }
    }

    // Ch 3: top genre's posters + %. Same tuple shape as topDirectors.
    const topGenreName = topGenres[0]?.[0] ?? null;
    const topGenreCount = topGenres[0]?.[1] ?? 0;
    const totalGenreCount = topGenres.reduce((sum, g) => sum + g[1], 0);
    const topGenrePercent = totalGenreCount > 0 ? Math.round((topGenreCount / totalGenreCount) * 100) : 0;
    const topGenrePosters: string[] = [];
    if (topGenreName) {
      for (const f of filmDetails) {
        if (f.genres.includes(topGenreName) && f.posterPath) {
          topGenrePosters.push(f.posterPath);
        }
      }
    }

    // Ch 4: hours, countries, longest film poster.
    let hoursWatched = 0;
    let longestFilmPoster: string | null = null;
    let longestFilmRuntime = 0;
    const countries = new Set<string>();
    for (const f of filmDetails) {
      if (typeof f.runtime === "number") hoursWatched += f.runtime;
      for (const c of f.countries ?? []) countries.add(c);
      if ((f.runtime ?? 0) > longestFilmRuntime && f.posterPath) {
        longestFilmRuntime = f.runtime ?? 0;
        longestFilmPoster = f.posterPath;
      }
    }
    hoursWatched = Math.round(hoursWatched / 60);

    // Ch 5: top-rated posters.
    const topRatedPosters: string[] = [];
    for (const tr of stats.topRated ?? []) {
      const p = posterBySlug.get(tr.slug);
      if (p) topRatedPosters.push(p);
    }

    return buildChapterContent({
      totalRated: ratingBySlug.size,
      p25Stars,
      p75Stars,
      topDirectorName,
      topDirectorFilmCount,
      topGenreName,
      topGenrePercent,
      hoursWatched,
      countryCount: countries.size,
      topRatedCount: Math.min(10, topRatedPosters.length),
      recentCount: (stats.recentActivity ?? []).length,
      fiveStarPosters,
      topDirectorPosters,
      topGenrePosters,
      longestFilmPoster,
      topRatedPosters,
    });
  }, [filmDetails, ratingBySlug, topDirectors, topGenres, stats.topRated, stats.recentActivity]);
```

**Note for engineer:** `topDirectors` and `topGenres` are tuple arrays (`[name, count][]`), which is why the code above uses `[0]?.[0]` / `[0]?.[1]` indexing. The `FilmDetail` fields (`posterPath`, `runtime`, `countries`, `directors`, `genres`) are confirmed optional/required per the `FilmDetail` interface at the top of `dashboard.tsx`. If anything doesn't compile, grep for the actual field names and adjust — do not change the shape of `FilmDetail`, only adapt the reads.

- [ ] **Step 4: Verify compile**

```bash
cd web && npm run build
```
If the build fails, fix field name mismatches and re-run. Commit only when it builds.

- [ ] **Step 5: Commit**

```bash
git add web/app/dashboard.tsx
git commit -m "Compute per-chapter content (subtitles, mural posters) in StatsView"
```

---

## Task 12: Restructure JSX — introduce chapter wrappers and reorder

This is the largest task. Approach: edit `StatsView`'s return JSX in one pass, wrapping sections into `<Chapter>` blocks and moving misaligned sections to their correct chapter. Do NOT modify the section internals — only the surrounding grouping.

**Files:**
- Modify: `web/app/dashboard.tsx` (the return statement of `StatsView`, roughly lines 1741–3040)

### Target shape (what the JSX should look like after this task)

Pseudocode — map each existing block to its new home:

```tsx
return (
  <div className="space-y-8">
    <StickyNav chapters={CHAPTERS} />

    {/* Intro — no chapter wrapper */}
    {/* Profile Header ... */}
    {/* Top Stats Row ... */}
    {/* CSV Upload banners ... */}
    {/* Enrichment progress bar ... */}

    <Chapter chapter={CHAPTERS[0]}>
      <ChapterHero chapter={CHAPTERS[0]} content={chapterContent["ch-1"]} />
      {/* Rating-free notice */}
      {/* Rating Distribution */}
      {/* PosterRibbon with chapterContent["ch-1"].posters  (4-star set) */}
      {/* Popularity + Likeability */}
      {/* User vs Crowd */}
    </Chapter>

    <Chapter chapter={CHAPTERS[1]}>
      <ChapterHero chapter={CHAPTERS[1]} content={chapterContent["ch-2"]} />
      {/* Most Watched Directors card — extracted from the "Top 3" row */}
      {/* Most Watched Actors card — extracted from the "Top 3" row */}
      {/* Power Duos — extracted from the Cinematic Age + Power Duos row */}
      {/* Highest-Rated People */}
    </Chapter>

    <Chapter chapter={CHAPTERS[2]}>
      <ChapterHero chapter={CHAPTERS[2]} content={chapterContent["ch-3"]} />
      {/* Most Watched Genres — extracted from the "Top 3" row */}
      {/* Top Genre Combinations */}
      {/* Top Themes */}
      {/* Genre Taste Profile */}
      {/* 5-Star Club / Liked Films Club */}
    </Chapter>

    <Chapter chapter={CHAPTERS[3]}>
      <ChapterHero chapter={CHAPTERS[3]} content={chapterContent["ch-4"]} />
      {/* Runtime Stats — extracted from 5-Star Club + Runtime row */}
      {/* Country Explorer */}
      {/* Films by Decade */}
      {/* Cinematic Age — extracted from the Cinematic Age + Power Duos row */}
    </Chapter>

    <Chapter chapter={CHAPTERS[4]}>
      <ChapterHero chapter={CHAPTERS[4]} content={chapterContent["ch-5"]} />
      {/* Top Rated Films */}
      {/* Recent Activity */}
    </Chapter>

    <Chapter chapter={CHAPTERS[5]}>
      <ChapterHero chapter={CHAPTERS[5]} content={chapterContent["ch-6"]} />
      {/* Find Your Match */}
    </Chapter>
  </div>
);
```

### Steps

- [ ] **Step 1: Unwrap the "Top 3" row (lines ~2054–2098)**

The existing JSX is a single `<div className="grid grid-cols-1 sm:grid-cols-3 gap-4">` containing three cards. Turn this into three standalone cards (remove the outer grid), each rendered as `<div className="bg-card border border-card-border rounded-xl p-6">`. They'll be placed individually inside Ch 2 / Ch 3 in later steps. For now, temporarily leave them in place — we're just un-gridding.

- [ ] **Step 2: Unwrap the Cinematic Age + Power Duos row (around line 2469)**

The row is a 2-column grid containing Cinematic Age (or "Your Decade") on the left and Power Duos on the right. Split into two standalone card blocks. Leave in place for now.

- [ ] **Step 3: Unwrap the 5-Star Club + Runtime Stats row (around line 2707)**

Same pattern: split into two standalone cards. Leave in place.

- [ ] **Step 4: Unwrap the Insights Section wrapper (around line 2118)**

The `<section>` or outer `<div>` wrapping Top Genre Combos → Country Explorer can be removed. All the children just become siblings. This step makes it possible to move individual children to different chapters in the next step.

- [ ] **Step 5: Verify build before reordering**

```bash
cd web && npm run build
```
Expected: build succeeds, dashboard still renders (just without its grid row layouts for the few rows we un-gridded — it'll look slightly worse, that's fine, the chapter wrappers fix it).

Commit this intermediate state:

```bash
git add web/app/dashboard.tsx
git commit -m "Unwrap cross-chapter row grids in StatsView (prep for chapter grouping)"
```

- [ ] **Step 6: Move sections into chapter order**

Cut each section from its current location and paste into the chapter-ordered sequence above. Work top-to-bottom in the target order. After moving:

- Intro block stays as-is (sections 1743–~2116 minus the Top 3 row, minus the rating-free notice and rating distribution which move to Ch 1).
- Wrap Ch 1 content in `<Chapter chapter={CHAPTERS[0]}>...</Chapter>`.
- Wrap Ch 2 content in `<Chapter chapter={CHAPTERS[1]}>...</Chapter>`.
- Continue through Ch 6.
- Insert `<ChapterHero chapter={CHAPTERS[N]} content={chapterContent["ch-N"]} />` as the first child of each `Chapter`.
- Insert `<StickyNav chapters={CHAPTERS} />` as the very first child of the outer `<div>`.

Do NOT modify anything inside a section — only the grouping. If a section is conditionally rendered (e.g., `{stats.source === "rss" && (...)}`), keep the conditional intact.

- [ ] **Step 7: Build and visually verify**

```bash
cd web && npm run build
cd web && npm run dev  # leave running
```
Open `http://localhost:3000/`, click "or see a demo profile". Expected:
- 6 chapter hero bands appear in order (`01 How You Rate` → `06 Find Your Match`)
- StickyNav appears after scrolling past intro; pill highlights match the current chapter
- Every original section is still present (just possibly in a different order)
- No console errors

If a section is missing, check whether it was skipped during the cut/paste.

- [ ] **Step 8: Commit**

```bash
git add web/app/dashboard.tsx
git commit -m "Restructure StatsView JSX into 6 thematic chapters with heroes and sticky nav"
```

---

## Task 13: Add poster ribbons between chart-heavy sections

**Files:**
- Modify: `web/app/dashboard.tsx`

- [ ] **Step 1: Add three `PosterRibbon` placements inside chapters**

The spec calls for ribbons at:
- **Ch 1:** between Rating Distribution and Popularity/Likeability — use 4-star posters (compute a `fourStarPosters` list inline from `ratingBySlug` + `posterBySlug` in a small useMemo).
- **Ch 3:** immediately after Most Watched Genres pie — reuse `chapterContent["ch-3"].posters`.
- **Ch 5:** immediately before Recent Activity — build from `stats.recentActivity` mapping to poster paths.

For Ch 1, add this useMemo near the `chapterContent` memo:

```tsx
  const fourStarPosters = useMemo(() => {
    const posterBySlug = new Map<string, string>();
    for (const f of filmDetails) {
      if (f.posterPath) posterBySlug.set(f.slug, f.posterPath);
    }
    const out: string[] = [];
    for (const [slug, rating] of ratingBySlug) {
      if (rating >= 4 && rating < 5) {
        const p = posterBySlug.get(slug);
        if (p) out.push(p);
      }
    }
    return out.slice(0, 5);
  }, [filmDetails, ratingBySlug]);
```

For Ch 5, reuse `chapterContent["ch-5"].posters` (top-rated) or derive a `recentPosters` list the same way if you want a different feel.

Insert ribbons in the JSX:

```tsx
// Ch 1, between Rating Distribution and Popularity:
<PosterRibbon posters={fourStarPosters} />

// Ch 3, after Most Watched Genres:
<PosterRibbon posters={chapterContent["ch-3"].posters} />

// Ch 5, before Recent Activity:
<PosterRibbon posters={chapterContent["ch-5"].posters} />
```

- [ ] **Step 2: Verify visually**

Dev server running: scroll through the three locations. Each ribbon is a thin row of 3–5 small posters, no labels.

- [ ] **Step 3: Commit**

```bash
git add web/app/dashboard.tsx
git commit -m "Add poster ribbons between chart-heavy sections in chapters 1, 3, 5"
```

---

## Task 14: Attach reveal-on-scroll to existing charts and cards

**Files:**
- Modify: `web/app/dashboard.tsx`

This task layers motion onto existing section JSX. Add `className="reveal"` plus a ref from `useRevealOnScroll` to each card-level `<div>`. Do this in one sweep.

- [ ] **Step 1: Apply `reveal` class to every card**

Find every JSX element that matches the pattern `<div className="bg-card border border-card-border rounded-xl p-6">` and change to:

```tsx
<div className="bg-card border border-card-border rounded-xl p-6 reveal" ref={useRevealOnScroll<HTMLDivElement>()}>
```

**Important:** `useRevealOnScroll()` can't be called inside JSX like that because hooks must be called at the top of the component. Instead, create a small wrapper component:

Create `web/app/components/RevealCard.tsx`:

```tsx
"use client";

import { ReactNode, HTMLAttributes } from "react";
import { useRevealOnScroll } from "../hooks/useRevealOnScroll";

export function RevealCard({
  children,
  className = "",
  ...rest
}: { children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  const ref = useRevealOnScroll<HTMLDivElement>();
  return (
    <div ref={ref} className={`reveal ${className}`} {...rest}>
      {children}
    </div>
  );
}
```

Import it at the top of `dashboard.tsx`:
```tsx
import { RevealCard } from "./components/RevealCard";
```

Then replace each `<div className="bg-card border border-card-border rounded-xl p-6">` in `StatsView`'s return JSX with:

```tsx
<RevealCard className="bg-card border border-card-border rounded-xl p-6">
```

And the corresponding closing `</div>` with `</RevealCard>`. Grep for the exact class string first so you can do this methodically:

```bash
grep -n "bg-card border border-card-border rounded-xl p-6" web/app/dashboard.tsx
```

- [ ] **Step 2: Add `reveal-bar` class to the bar-chart bars**

Inside the `BarChart` and `RatingBar` components (line ~124 and ~302), find the bar element that renders the actual rectangle — e.g. the `<rect fill="...">` or the `<div style={{ width: "..." }}>` — and add `className="reveal-bar"` to it. Bars will grow in from left when their parent card's `.reveal` toggles via cascaded class (since the parent has `.revealed`, descendants can read it via CSS):

Update the CSS in `globals.css` to cascade — replace the `.reveal-bar` block with:

```css
.reveal-bar {
  transform-origin: left center;
  transform: scaleX(0);
  transition: transform 700ms cubic-bezier(0.2, 0.8, 0.2, 1);
  transition-delay: 150ms;
  will-change: transform;
}

.revealed .reveal-bar,
.reveal-bar.revealed {
  transform: scaleX(1);
}
```

This way, a bar inside a `RevealCard` auto-animates when the card reveals.

- [ ] **Step 3: Add `reveal-scale` class to PieChart and world-map SVGs**

In `PieChart` (line ~208) and the world map inside Country Explorer, add `className="reveal-scale"` to the outer `<svg>`. Same cascade approach — parent `.revealed` triggers the descendant `.reveal-scale` transition.

Add to `globals.css`:
```css
.revealed .reveal-scale {
  opacity: 1;
  transform: scale(1);
}
```

- [ ] **Step 4: Use `useCountUp` on the three hero stats**

The three stats in the Top Stats Row (avg rating, total rated, total tracked) should count up. Wrap each number display with `useCountUp`:

Inside `StatsView`, before the return, add:

```tsx
  const avgRatingCounter = useCountUp(stats.avgRating, { decimals: 2 });
  const totalRatedCounter = useCountUp(stats.totalRated);
  const totalFilmsCounter = useCountUp(stats.totalFilms);
```

Then in the Top Stats Row JSX, replace the static rendering of each number. E.g., a card that currently renders:

```tsx
<p className="text-3xl font-bold text-accent">{stats.avgRating.toFixed(2)}</p>
```

becomes:

```tsx
<p ref={avgRatingCounter.ref} className="text-3xl font-bold text-accent">
  {avgRatingCounter.formatted}
</p>
```

And similarly for `totalRated` and `totalFilms`.

Also apply `useCountUp` to:
- Cinematic Age large number
- Runtime Stats — `Hours Watched` number

- [ ] **Step 5: Visually verify**

Dev server running: reload the demo dashboard. Expected:
- Cards fade + rise as you scroll into them (once per page load)
- Bar charts bars grow from left
- Pie and world map fade + scale in
- Avg rating, Films Rated, Total Tracked, Cinematic Age, Hours Watched all count up the first time they enter view

Force `prefers-reduced-motion: reduce` in DevTools (`Cmd+Shift+P` → "reduced motion") and reload — every animation should be skipped and elements should render in their final state.

- [ ] **Step 6: Commit**

```bash
git add web/app/dashboard.tsx web/app/components/RevealCard.tsx web/app/globals.css
git commit -m "Animate dashboard cards, charts, and hero numbers on scroll"
```

---

## Task 15: Restrict accent-green usage

**Files:**
- Modify: `web/app/dashboard.tsx`

Currently `text-accent` (class) and `--accent` are used on many numbers throughout the dashboard. Restrict to the set defined in the spec.

- [ ] **Step 1: Enumerate current `text-accent` occurrences**

```bash
grep -nE "text-accent[^-]|text-\[var\(--accent\)\]" web/app/dashboard.tsx
```

- [ ] **Step 2: Keep `text-accent` only on these elements** (check each match from step 1 against this whitelist)

Keep accent green on:
- Chapter numbers (inside `ChapterHero` — already handled).
- Top Stats Row: **Avg Rating** number only (not Films Rated, not Total Tracked).
- **Cinematic Age** large number.
- **Runtime Stats: Hours Watched** large number.
- Active pill in `StickyNav` (already handled).
- Links (e.g. "View on Letterboxd", "or see a demo profile") — keep as-is.
- The existing bar-chart fill color (keep — it's the chart's primary color).
- The pie chart's slice palette (untouched — has its own colors).
- `Genre Taste Profile` card: the avg rating per genre (e.g. "4.2/5") — keep accent here, it's the reading users care about.
- `Highest-Rated People` weighted avg (e.g. "5.0/5") — keep.

Remove accent from (replace `text-accent` with `text-foreground` or remove the class):
- `Films Rated` number (Top Stats Row)
- `Total Tracked` number (Top Stats Row)
- Any other big stat numbers that aren't in the whitelist above

Work through each match from step 1. When in doubt, leave the class in place — regression risk is worse than minor inconsistency.

- [ ] **Step 3: Visually verify hierarchy**

Dev server running: reload. Expected: the remaining greens (avg rating, cinematic age, hours watched, chapter numbers, active nav pill, genre taste ratings, highest-rated ratings) feel like genuine emphasis — not wallpaper.

- [ ] **Step 4: Commit**

```bash
git add web/app/dashboard.tsx
git commit -m "Restrict accent green to hero numbers for clearer hierarchy"
```

---

## Task 16: End-to-end verification pass

**Files:**
- (no code changes)

- [ ] **Step 1: Reload the demo dashboard and walk the full scroll**

With dev server running, open `http://localhost:3000/` and click "or see a demo profile". Scroll from top to bottom. Verify:
1. **Intro** shows Profile Header, Top Stats Row (avg rating counts up, other two don't have accent green), CSV upload banner.
2. **Sticky nav** appears once you scroll past the intro — 6 pills visible, current one highlighted.
3. **Ch 1 hero** — "01 How You Rate" with 5-star poster mural, data-driven subtitle.
4. Rating Distribution card fades in; bars grow from left.
5. Poster ribbon of 4-star films appears.
6. Popularity and Likeability sections fade in.
7. User vs Crowd.
8. **Ch 2 hero** — "02 Your People" with top director's filmography fanned behind.
9. Most Watched Directors + Most Watched Actors (now standalone cards, no longer side-by-side with Genres).
10. Power Duos — **no "Tarantino + Tarantino"** self-pair.
11. Highest-Rated People.
12. **Ch 3 hero** — "03 Your Taste" with genre mosaic.
13. Most Watched Genres pie.
14. Poster ribbon of top-genre films.
15. Top Genre Combos, Themes, Genre Taste Profile, 5-Star Club.
16. **Ch 4 hero** — "04 Scale & Reach" with longest film as hero poster.
17. Runtime Stats (hours counts up), Country Explorer, Films by Decade, Cinematic Age (counts up).
18. **Ch 5 hero** — "05 Your Films" with top-rated poster stack.
19. Top Rated Films, Poster ribbon, Recent Activity.
20. **Ch 6 hero** — "06 Find Your Match", then the Find Your Match CTA.
21. No console errors. No broken images (missing poster fallback rendered).
22. Clicking any sticky nav pill smooth-scrolls to that chapter.

- [ ] **Step 2: Reduced-motion check**

In Chrome DevTools command palette: "Emulate CSS prefers-reduced-motion" → "reduce". Reload. Expected: no animations fire, no count-ups, posters and charts appear in final state immediately.

- [ ] **Step 3: Mobile check**

Resize viewport to ~390×844 (iPhone 13). Expected:
- Sticky nav pills are horizontally scrollable
- Chapter heroes stack nicely, title shrinks, mural remains readable
- No horizontal overflow

- [ ] **Step 4: Build check**

```bash
cd web && npm run build
```
Expected: passes.

- [ ] **Step 5: Lint check**

```bash
cd web && npm run lint
```
Expected: passes (or matches pre-change warning state).

- [ ] **Step 6: Final commit (if any fixes were made during verification)**

If step 1–5 turned up issues that needed a fix, commit the fix:

```bash
git add -A
git commit -m "Fix verification issues in dashboard chapter reorg"
```

Otherwise, nothing to commit — the feature is done.

---

## Post-implementation

After Task 16 passes, this spec is complete. The branch is ready for:
1. Code review (see `superpowers:requesting-code-review`).
2. Merging to `main`.
3. Brainstorming **Spec B** (Wrapped-style opening sequence) — separate worktree + session.
