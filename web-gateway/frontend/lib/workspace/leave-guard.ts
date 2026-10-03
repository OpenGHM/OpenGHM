"use client";

import { useEffect, useState } from "react";

/**
 * Where a click would take the page, when that is somewhere else in this app
 * and the click is the plain kind a router follows. Null for everything the
 * guard leaves alone: a click another handler already took, a modified or
 * non-primary click (a new tab), a link that opens elsewhere or downloads, one
 * to another origin (the browser's own prompt covers those), a link to this
 * page itself (the wizard's step links, an anchor), and a click not on a link.
 *
 * `ownPath` is the wizard's own path without its query; any link under it is
 * the wizard's.
 */
export function leavingHref(
  event: Pick<MouseEvent, "defaultPrevented" | "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "target">,
  page: { origin: string; ownPath: string }
): string | null {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const target = event.target;
  if (!(target instanceof Element)) return null;
  const anchor = target.closest("a[href]");
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  if (anchor.target !== "" && anchor.target !== "_self") return null;
  if (anchor.hasAttribute("download")) return null;
  let url: URL;
  try {
    url = new URL(anchor.href, page.origin);
  } catch {
    return null;
  }
  if (url.origin !== page.origin) return null;
  if (url.pathname === page.ownPath) return null;
  return url.pathname + url.search + url.hash;
}

/**
 * Stops a page with something unsaved from being left without a say, while
 * `active`:
 * - the browser's own prompt on a reload, a closed tab or a link that is not
 *   ours (`beforeunload`, unless `beforeUnload` is off);
 * - a plain click on an in-app link (the header, the breadcrumb, Cancel, the
 *   footer) is held back, and the link it would have followed is returned as
 *   `target`, for the page to ask what to do. `stay()` forgets it.
 *
 * The browser's Back and Forward cannot be held back from here: leaving that
 * way is not asked about (`popstate` cannot be cancelled).
 *
 * Switch it off (`active` false) before navigating on purpose, or the guard
 * asks about its own navigation.
 */
export function useLeaveGuard({
  active,
  ownPath,
  beforeUnload = true,
}: {
  active: boolean;
  ownPath: string;
  /** Ask the browser too. Off when something else already does (a stored
   *  draft's saver asks while it has unsaved work). */
  beforeUnload?: boolean;
}) {
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    const onClick = (event: MouseEvent) => {
      const href = leavingHref(event, { origin: window.location.origin, ownPath });
      if (href === null) return;
      // Capture phase, before Next's Link: it will not navigate.
      event.preventDefault();
      event.stopPropagation();
      setTarget(href);
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    document.addEventListener("click", onClick, true);
    if (beforeUnload) window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [active, ownPath, beforeUnload]);

  return { target, stay: () => setTarget(null) };
}
