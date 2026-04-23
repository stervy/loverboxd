# Dashboard Chapter Reorg — Design

**Status:** approved (brainstorm)
**Date:** 2026-04-21
**Scope:** Spec A of three (A: reorganize + polish; B: Wrapped-style hero — separate spec; C: new features — separate spec).

## Problem

The current dashboard (`web/app/dashboard.tsx`, ~3.3k lines) is a flat ~6000px scroll of 20 stacked sections with no navigation, near-monochrome accent green on nearly every number, and no pacing. Users scroll through a wall of similar-looking cards. The content is rich, but nothing helps it breathe, and there's no visual journey.

User goals: keep every existing section, make the long scroll feel like a "fun and scrollable" journey, add navigation without collapsing anything.

## Approach

Group the 20 existing sections into **6 thematic chapters** and add three coordinated layers of structure on top:

1. **Chapter hero dividers** — a full-width ~70vh band per chapter with big editorial typography and a contextual poster mural.
2. **Sticky top nav** — 6 chapter pills that appear after the intro, with current-chapter tracking via IntersectionObserver.
3. **Motion + visual rhythm** — scroll-triggered reveal animations, poster-ribbon strips between chart-heavy sections inside a chapter, parallax on hero murals.

Plus two polish items folded in: fix the self-paired Power Duos bug and restrict accent green to a small set of "hero" numbers so the remaining greens actually feel like accents.

No existing section is removed, renamed, or restructured internally. All changes are additive wrappers or scoped CSS/behavior adjustments.

## Chapter grouping

| # | Chapter | Contains |
|---|---|---|
| — | Intro | Profile Header · Top Stats Row · Data Upload Banner |
| 1 | How You Rate | Rating Distribution · Popularity · Likeability · User vs Crowd |
| 2 | Your People | Most Watched Directors · Most Watched Actors · Power Duos · Highest-Rated People |
| 3 | Your Taste | Most Watched Genres · Genre Combos · Themes · Genre Taste Profile · 5-Star Club |
| 4 | Scale & Reach | Runtime Stats · Country Explorer · Films by Decade · Cinematic Age |
| 5 | Your Films | Top Rated Films · Recent Activity |
| 6 | Find Your Match | Find Your Match CTA |

The existing "Top 3" row (Directors/Genres/Actors) is split: Directors & Actors → Ch 2; Genres → Ch 3. Row unity is sacrificed for thematic unity.

**Placement of conditional sections:**
- **No-Ratings Notice** lives at the top of Ch 1 (it explains why rating-dependent charts inside Ch 1 are hidden).
- **Enrichment Progress Bar** lives in the Intro block, just below the Data Upload Banner — it's a global loading indicator, not chapter-specific.

**Empty-chapter handling:** if every section inside a chapter is conditionally hidden (e.g., a rating-free user for Ch 1), the chapter hero divider and the chapter's nav pill are both skipped. The chapter is effectively invisible.

## Chapter hero divider

A reusable `ChapterHero` component. Full-width band, ~70vh tall (not full viewport — scroll-snap feels forced on a stats page).

**Layout** (desktop):
- Top-left: chapter number ("01" – "06") in accent green at reduced opacity, large (~96px).
- Center-left: chapter title ("How You Rate"), heavy editorial weight, ~80–120px.
- Below title: a data-driven subtitle that reads like a pull-quote. Uses stats the dashboard already computes (no new data work).
- Right/background: a contextual poster mural per chapter.
- Bottom: subtle animated scroll-down cue (↓), fades out once user has scrolled past ~20% of the chapter.

**Mobile:** title scales down (~48px), mural becomes a softened full-bleed background behind the text.

**Subtitle formulas** (computed from existing data):
- Ch 1: "You've rated {totalRated} films, and you mostly land between {p25}–{p75} stars."
- Ch 2: "{topDirector} tops your list — you've watched {count} of their films."
- Ch 3: "{topGenre} leads your taste, at {percent}% of what you watch."
- Ch 4: "{hoursWatched} hours across {countryCount} countries."
- Ch 5: "Your top {topCount} films, and your last {recentCount} watches."
- Ch 6: "See how your taste lines up with a friend."

If any input is missing for a subtitle, fall back to a plain chapter tagline (e.g., "The way you score" for Ch 1).

**Poster mural per chapter:**
- Ch 1 → user's 5-star film posters in a cascading diagonal (up to 6 posters).
- Ch 2 → posters from top director's filmography, fanned stack (3–5 posters).
- Ch 3 → posters from top 3 genres, small mosaic (up to 9 posters).
- Ch 4 → faded world map silhouette with user's countries highlighted, OR longest film as single hero poster (pick longest-film option — map already appears in-section below).
- Ch 5 → top-rated posters in a soft cinematic stack.
- Ch 6 → split-screen: user's avatar on left, "?" card on right.

Mural images come from existing TMDB poster paths in `filmDetails`. If a chapter has no poster data (e.g., pre-enrichment), fall back to a geometric accent-color pattern instead of a mural.

**Motion:** hero parallax — mural translates slower than title text on scroll (CSS `transform` driven by scroll position). Title fades + slides in when hero enters viewport.

**Color:** chapter number in existing accent green (`#00c030`). Body text monochrome over dark bg so posters pop.

## Sticky top nav

A top bar that appears after the user scrolls past the intro block (roughly past the Top Stats Row).

- 6 chapter pills: "01 How You Rate" ... "06 Find Your Match" (number compact, title readable).
- Current chapter tracked via IntersectionObserver on each chapter hero; updates pill active state.
- Click a pill → smooth-scroll to that chapter hero.
- Height ~52px. Translucent dark background with `backdrop-filter: blur(8px)`.
- Mobile: horizontally scrollable pill strip (overflow-x auto), pills smaller.
- Does not appear on the initial username-entry page — only on a loaded dashboard.
- Hides on scroll-down, reveals on scroll-up (optional; skip if it complicates). Default: stays pinned.

## Motion and reveal animations

All implemented with a single IntersectionObserver utility plus CSS transitions (no animation library dependency added):

- **Numbers:** count up from 0 to target on first visibility, duration ~800ms, ease-out.
- **Bar charts:** bars draw in from left (width transition), staggered by ~40ms each.
- **Pie chart:** fade + slight scale (0.92 → 1) on enter.
- **World map:** country fills fade in.
- **Posters:** fade + 8px upward slide.
- **Hero murals:** parallax translateY as discussed above.

Animate-once (the observer unsubscribes after the element has animated once; does not replay on scroll-back).

Respects `prefers-reduced-motion: reduce` — when set, all motion is skipped; elements render in their end state immediately.

## Poster ribbons between sections

Inside a chapter, between chart-heavy sections, a thin 3–5-poster ribbon strip (no labels, ~120px tall). Purely decorative texture. Examples:

- Ch 1, between Rating Distribution and Popularity: 4-star films.
- Ch 3, after Most Watched Genres pie: posters from that top genre.
- Ch 5, immediately before Recent Activity: most recent watches.

Ribbons are optional per chapter (add where the chart density is highest). If data isn't available yet, ribbon is skipped — no placeholder empty state.

## Accent green restriction

Currently, accent green (`#00c030`) is applied to nearly every number and highlight. Restrict it to:

- Chapter numbers ("01"–"06")
- Top Stats Row: Avg Rating
- Cinematic Age large number
- Runtime Stats: Hours Watched large number
- Sticky nav: active pill highlight
- Links on hover

Everywhere else, numbers switch from accent green to foreground (`#d8d8d8`), with size/weight carrying emphasis instead. This happens globally via updating the specific `text-accent` class usages — not by changing CSS variables.

## Power Duos self-pairing fix

Filter out duos where `personA.id === personB.id` before ranking. Small scoped fix in the duo-building logic.

## Boundaries of this spec

**In scope:** chapter grouping, hero dividers, sticky nav, scroll animations, poster ribbons, accent-color restriction, Power Duos self-pair fix.

**Out of scope (separate specs B and C):**
- Wrapped-style hero "opening sequence" before Chapter 1 (spec B).
- New features: taste archetype, watching timeline, shareable card, watchlist recs, network graph (spec C).
- Any change to data shape, new data sources, or enrichment pipeline.
- Mobile redesign beyond responsive behavior of the new components.

## Risks and trade-offs

- **Parallax + sticky nav + count-up animations** can feel janky on low-end devices. Mitigated by `prefers-reduced-motion` support and keeping animations CSS-based (no heavy JS frame loops).
- **Six chapters may be too many for the narrow mobile nav.** Horizontal-scroll pills is the fallback; if it feels bad in practice, reduce to chapter-number-only pills on mobile (01/02/03).
- **Mural posters increase image payload.** Use lower-resolution TMDB variants (`w185` or `w342`) for mural positions that don't need full-res.
- **Accent-green restriction** is the most likely point of style regression — any component currently relying on green for legibility needs manual review during implementation.

## Implementation structure (preview)

This section is a preview only; the detailed plan lives in the implementation plan produced by `writing-plans`.

- New: `web/app/components/ChapterHero.tsx`, `StickyNav.tsx`, `PosterRibbon.tsx`, `useRevealOnScroll.ts`, `useCountUp.ts`.
- Modified: `web/app/dashboard.tsx` — wraps existing sections into chapter groupings; imports the new components.
- Modified: `web/app/globals.css` — adds animation keyframes, audits accent-green usage.
- Modified: duo-computation helper to dedupe self-pairs.

Existing section components are not rewritten.
