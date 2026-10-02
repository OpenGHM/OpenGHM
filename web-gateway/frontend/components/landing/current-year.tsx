"use client";

import { useEffect, useRef } from "react";

/**
 * The current calendar year, for a copyright line. A statically prerendered
 * page carries the year it was built in, so the browser sets the year again
 * once mounted: a page built last December reads right in January.
 *
 * The one case that differs is a build from an earlier year: the markup says
 * one year and the first client render another. `suppressHydrationWarning`
 * keeps that from being an error, but React then leaves the server's text in
 * place, so the effect writes the year into the element itself. When the years
 * agree (the usual case) it finds nothing to change.
 */
export function CurrentYear() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const year = String(new Date().getFullYear());
    if (ref.current && ref.current.textContent !== year) ref.current.textContent = year;
  }, []);
  return (
    <span ref={ref} suppressHydrationWarning>
      {new Date().getFullYear()}
    </span>
  );
}
