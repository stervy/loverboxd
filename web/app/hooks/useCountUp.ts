"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Returns a number that animates from 0 to `target` once the ref'd element
 * first enters the viewport. Respects `prefers-reduced-motion`.
 *
 * Example:
 *   const { ref, formatted } = useCountUp(772, { durationMs: 800 });
 *   <span ref={ref}>{formatted}</span>
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

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // Defer one frame to avoid a synchronous setState-in-effect cascade.
      const raf = requestAnimationFrame(() => setValue(target));
      return () => cancelAnimationFrame(raf);
    }

    const duration = opts?.durationMs ?? 800;

    const start = () => {
      if (startedRef.current) return;
      startedRef.current = true;
      const startTs = performance.now();
      const step = (now: number) => {
        const elapsed = now - startTs;
        const t = Math.min(elapsed / duration, 1);
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
