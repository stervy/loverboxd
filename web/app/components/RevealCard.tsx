"use client";

import { ReactNode, HTMLAttributes } from "react";
import { useRevealOnScroll } from "../hooks/useRevealOnScroll";

/**
 * Drop-in card wrapper that animates into view on first intersection.
 * Use in place of a plain `<div className="bg-card border ...">` when you
 * want scroll-triggered reveal.
 */
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
