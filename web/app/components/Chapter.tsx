"use client";

import { ReactNode } from "react";

export interface ChapterDef {
  id: string;
  number: string;
  title: string;
}

/**
 * Chapter is a pure structural wrapper: `<section id={id} data-chapter={id}>`.
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
