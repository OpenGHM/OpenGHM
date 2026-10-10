"use client";

import { useEffect, useRef } from "react";

/**
 * Asks before unsaved input is thrown away: a reload, closing the tab, and a
 * click on a link to another page of this site. (The browser's own Back button
 * is covered by `beforeunload` only when it leaves the site.) Nothing is saved
 * by itself; the person saves with the button or Ctrl or Cmd + S.
 */
export function useUnsavedGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers read the return value.
      event.returnValue = "";
    };
    const clickLink = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.origin !== window.location.origin) return;
      if (anchor.pathname === window.location.pathname && anchor.search === window.location.search) return;
      if (!window.confirm("You have unsaved changes. Leave this page and discard them?")) {
        // Next's link handler listens on the same click; stop it before it navigates.
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", clickLink, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", clickLink, true);
    };
  }, [dirty]);
}

/** Ctrl or Cmd + S runs `onSave` instead of the browser's "save page". */
export function useSaveShortcut(onSave: () => void) {
  const latest = useRef(onSave);
  useEffect(() => {
    latest.current = onSave;
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        latest.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
