"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/** A page change must be this slow before the bar shows at all. */
const SHOW_AFTER_MS = 200;
/** The bar never outlives this, whatever the router does. */
const GIVE_UP_AFTER_MS = 10_000;
/** The length of the finishing move: the run to 100% and the fade. */
const FINISH_MS = 400;

type Phase =
  /** Not navigating. */
  | "idle"
  /** A link was clicked; the bar waits out `SHOW_AFTER_MS` unseen. */
  | "pending"
  /** Slow enough to show: creeping toward 80%. */
  | "active"
  /** The page arrived: run to 100% and fade out. */
  | "completing";

/**
 * The link a click landed on, if it starts a client-side navigation to another
 * URL of this app: a plain left click on an `<a>` to the same origin whose path
 * or query differs from the current one. A new tab, a download, a modified
 * click, an external site, a mailto and a `#hash` on this page are not.
 */
function navigationTarget(event: MouseEvent): URL | null {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return null;
  }
  const anchor = event.target instanceof Element ? event.target.closest("a") : null;
  if (!anchor || !anchor.hasAttribute("href") || anchor.hasAttribute("download")) return null;
  if (anchor.target && anchor.target !== "_self") return null;

  let url: URL;
  try {
    url = new URL(anchor.href, window.location.href);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin) return null;
  if (url.pathname === window.location.pathname && url.search === window.location.search) {
    return null;
  }
  return url;
}

function ProgressBar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const location = `${pathname}?${searchParams}`;

  const [phase, setPhase] = useState<Phase>("idle");

  // A click on a link to another URL starts the bar. The listener is on the
  // document in the capture phase and does not look at `defaultPrevented`: a
  // Next `<Link>` cancels the browser's own navigation itself (it navigates
  // through the router), so by the time a click bubbles up to the document every
  // Link click is already prevented, and skipping those would skip them all.
  // It does not touch the navigation itself.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (navigationTarget(event)) setPhase("pending");
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // The URL changed: the navigation is over. A bar nobody saw simply goes; a
  // visible one finishes and fades.
  const [seen, setSeen] = useState(location);
  if (seen !== location) {
    setSeen(location);
    setPhase(phase === "active" ? "completing" : "idle");
  }

  // Each phase hands over to the next on a timer: unseen to creeping after
  // 200 ms, creeping to gone after the safety timeout, finishing to gone once
  // it has faded.
  useEffect(() => {
    if (phase === "idle") return;
    const timer = window.setTimeout(
      () => setPhase(phase === "pending" ? "active" : "idle"),
      phase === "pending" ? SHOW_AFTER_MS : phase === "active" ? GIVE_UP_AFTER_MS - SHOW_AFTER_MS : FINISH_MS
    );
    return () => window.clearTimeout(timer);
  }, [phase]);

  if (phase === "idle") return null;
  return (
    <div
      role="progressbar"
      aria-label="Loading page"
      aria-hidden={phase === "pending" ? "true" : undefined}
      data-phase={phase}
      className="nav-progress pointer-events-none fixed top-0 left-0 z-[100] h-0.5 bg-primary"
    />
  );
}

/**
 * A 2 px bar at the top of the viewport for a page change that is slow: the
 * route has no `loading.tsx`, or the server is. It starts on a click on an
 * internal link, shows only if the page has not arrived within 200 ms, creeps
 * toward 80% while it waits and finishes when the URL changes. A fast change
 * never shows it. Mounted once, in the root layout.
 */
export function NavigationProgress() {
  // `useSearchParams` needs a Suspense boundary above it.
  return (
    <Suspense fallback={null}>
      <ProgressBar />
    </Suspense>
  );
}
