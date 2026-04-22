"use client";

import Image from "next/image";
import { useRevealOnScroll } from "../hooks/useRevealOnScroll";

function tmdbPosterUrl(path: string): string {
  return `https://image.tmdb.org/t/p/w185${path}`;
}

/**
 * Thin decorative strip of 3–5 posters used between chart-heavy sections
 * inside a chapter. Purely visual rhythm — no interaction, no labels.
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
