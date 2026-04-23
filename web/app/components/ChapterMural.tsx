"use client";

import Image from "next/image";
import type { ChapterId } from "../lib/chapter-data";

function tmdbPosterUrl(path: string, size: "w185" | "w342" = "w342"): string {
  return `https://image.tmdb.org/t/p/${size}${path}`;
}

/**
 * Renders a contextual poster mural per chapter. Layouts vary by chapter to
 * reinforce its theme. All murals are absolutely positioned so the
 * ChapterHero overlays text on top.
 */
export function ChapterMural({
  chapterId,
  posters,
}: {
  chapterId: ChapterId;
  posters: string[];
}) {
  if (posters.length === 0) {
    return (
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-br from-accent/10 via-transparent to-accent/5 pointer-events-none"
      />
    );
  }

  switch (chapterId) {
    case "ch-1":
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
