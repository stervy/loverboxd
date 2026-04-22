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
  posters: string[];
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
