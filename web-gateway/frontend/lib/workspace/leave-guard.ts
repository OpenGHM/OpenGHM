"use client";

import { useEffect, useRef, useState } from "react";

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

/** What a held-back move was heading for, to complete once the person says go. */
export type LeaveTarget =
  /** A click on an in-app link: `href` is where it pointed. */
  | { kind: "link"; href: string }
  /** The browser's Back or Forward (or a jump in its history menu): `key` is
   *  the history entry it was heading for. */
  | { kind: "history"; key: string };

/**
 * The Navigation API, as far as the guard uses it: a `navigate` event that a
 * traversal fires first, which can be cancelled, and history entries with
 * stable keys that can be traversed to. Not in lib.dom for the TypeScript this
 * app uses, and not in every browser (see `useLeaveGuard`).
 */
interface NavigateEventLike extends Event {
  readonly navigationType: string;
  readonly destination: { readonly key: string | null; readonly url: string };
}
interface NavigationLike extends EventTarget {
  traverseTo(key: string): { committed: Promise<unknown>; finished: Promise<unknown> };
}
const navigationApi = (): NavigationLike | null =>
  (window as unknown as { navigation?: NavigationLike }).navigation ?? null;

/** Traverse to a history entry by key. False when that cannot even be tried
 *  (the entry is gone); `onFail` runs when the traversal starts and then fails. */
function traverseTo(navigation: NavigationLike, key: string, onFail: () => void): boolean {
  try {
    const { committed, finished } = navigation.traverseTo(key);
    committed.catch(onFail);
    finished.catch(onFail);
    return true;
  } catch {
    return false;
  }
}

/** The path of a URL on this origin, or null for anything else. */
function pathOf(url: string): string | null {
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.origin === window.location.origin ? parsed.pathname : null;
  } catch {
    return null;
  }
}

/**
 * Stops a page with something unsaved from being left without a say, while
 * `active`:
 * - the browser's own prompt on a reload, a closed tab or a link that is not
 *   ours (`beforeunload`, unless `beforeUnload` is off);
 * - a plain click on an in-app link (the header, the breadcrumb, Cancel, the
 *   footer) is held back, and the link it would have followed is returned as
 *   `target`, for the page to ask what to do. `stay()` forgets it;
 * - the browser's Back and Forward, when they would leave the page (the path
 *   changes; a move between the page's own `?step=` entries is not leaving).
 *   `popstate` cannot be cancelled, and Next's App Router listens to it from
 *   the moment the app mounts, before anything here can (at `window` the
 *   listeners run in the order they were added, `capture` or not), so there is
 *   no stopping it from there. The Navigation API's `navigate` event comes
 *   first and can be cancelled: the traversal then never happens, the URL
 *   stays, Next and the page never hear of it, and no history entry is added or
 *   rewritten. `target` is `{ kind: "history" }` with the entry it was heading
 *   for, and `proceed()` completes the move by traversing to that entry.
 *
 * Switch it off (`active` false) before navigating on purpose, or the guard
 * asks about its own navigation. `proceed()` also lifts the guard for the move
 * it completes, so that the browser's prompt does not come on top of the
 * dialog.
 *
 * **Browsers.** The history part needs the Navigation API (Chrome and Edge
 * have it; Safari and Firefox are open, not checked here). Without it Back and
 * Forward are not held back, as before. Even with it a browser may decline to
 * let a traversal be cancelled (`cancelable` is false: Chrome does so for a
 * Back without fresh user activation on the page since the last one it
 * cancelled); that move goes through, and is not fought. Leaving to another
 * document (a reload, another site) is the `beforeunload` prompt's alone.
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
  const [target, setTarget] = useState<LeaveTarget | null>(null);
  // The person said go: let the move through, and do not ask the browser either.
  const confirmed = useRef(false);

  useEffect(() => {
    if (!active) return;
    confirmed.current = false;
    const onClick = (event: MouseEvent) => {
      const href = leavingHref(event, { origin: window.location.origin, ownPath });
      if (href === null) return;
      // Capture phase, before Next's Link: it will not navigate.
      event.preventDefault();
      event.stopPropagation();
      setTarget({ kind: "link", href });
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (confirmed.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    // Back and Forward. Only a traversal that goes somewhere else is held; a
    // move to another entry on `ownPath` (another step) is the page's own, and
    // pushes and replaces are Next's and the page's own doing.
    const onNavigate = (event: Event) => {
      const { navigationType, destination } = event as NavigateEventLike;
      if (confirmed.current || navigationType !== "traverse" || !event.cancelable) return;
      if (!destination.key || pathOf(destination.url) === ownPath) return;
      event.preventDefault();
      setTarget({ kind: "history", key: destination.key });
    };
    document.addEventListener("click", onClick, true);
    if (beforeUnload) window.addEventListener("beforeunload", onBeforeUnload);
    const navigation = navigationApi();
    navigation?.addEventListener("navigate", onNavigate);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", onBeforeUnload);
      navigation?.removeEventListener("navigate", onNavigate);
    };
  }, [active, ownPath, beforeUnload]);

  return {
    target,
    stay: () => setTarget(null),
    /** Complete the held-back move: `push` follows a link; a history move is
     *  traversed to, and Next takes it as it would have. Nothing asks again,
     *  whether or not `active` has been switched off yet. */
    proceed(held: LeaveTarget, push: (href: string) => void) {
      if (held.kind === "link") {
        push(held.href);
        return;
      }
      const navigation = navigationApi();
      if (!navigation) return;
      confirmed.current = true;
      // The entry is gone or the traversal fails: the page stays where it is.
      const lift = () => (confirmed.current = false);
      if (!traverseTo(navigation, held.key, lift)) lift();
    },
  };
}
