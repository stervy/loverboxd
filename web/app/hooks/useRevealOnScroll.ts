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
