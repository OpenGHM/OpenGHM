"use client";

import Link from "next/link";
import { SEGMENTED_TRACK, segmentClass, segmentCountClass } from "@/components/workspace/segmented";
import { KIND_TABS, kindHref, type KindFilter } from "@/lib/workspace/my-data";

/**
 * The click handler of a link to `href` on this page: a plain click pushes the
 * URL and stays; a click with a modifier (a new tab, a download) is left to
 * the browser.
 */
export function pushOnPlainClick(href: string) {
  return (e: React.MouseEvent) => {
    const plain = e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
    if (e.defaultPrevented || !plain) return;
    e.preventDefault();
    if (window.location.pathname + window.location.search !== href) {
      window.history.pushState(null, "", href);
    }
  };
}

/**
 * The list's kind filter: All, Model Snapshots, Model Inputs, each with its
 * count. Each is a link to its own URL (`?kind=`), so it can be opened in a
 * new tab or copied, and a plain click only pushes that URL with
 * `history.pushState`: the list is filtered in the browser, and a router
 * navigation would render the server page and fetch it all again for
 * nothing. Next's router follows a native pushState, so `useSearchParams`
 * sees the new URL, and back and forward step through the selections.
 *
 * Drawn as the simulation list's filter is (`segmented.ts`). On a phone the
 * control scrolls inside itself; the page never does.
 */
export function MyDataKindTabs({
  active,
  counts,
}: {
  active: KindFilter;
  counts: Record<KindFilter, number>;
}) {
  return (
    <nav aria-label="Filter by type" className={SEGMENTED_TRACK}>
      <ul className="flex gap-0.5">
        {KIND_TABS.map((tab) => {
          const selected = tab.value === active;
          const href = kindHref(tab.value);
          return (
            <li key={tab.value} className="shrink-0">
              <Link
                href={href}
                prefetch={false}
                aria-current={selected ? "page" : undefined}
                onClick={pushOnPlainClick(href)}
                className={segmentClass(selected)}
              >
                {tab.label}
                <span className={segmentCountClass(selected)}>{counts[tab.value]}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
