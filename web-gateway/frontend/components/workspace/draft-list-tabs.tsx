import Link from "next/link";
import { LinkPending } from "@/components/ui/link-pending";
import {
  SEGMENTED_TRACK,
  segmentClass,
  segmentCountClass,
  segmentDotClass,
} from "@/components/workspace/segmented";
import { STATUS_TABS, listHref, type ListView, type StatusTab } from "@/lib/jobs/filters";
import type { JobStatsResponse } from "@/lib/jobs/types";

/** The dot of each tab, in the hue of the status it collects (the `--status-*`
 *  tokens, written whole because Tailwind reads source text). */
const TAB_DOT: Record<string, string> = {
  All: "bg-hero",
  Editing: "bg-status-draft",
  Active: "bg-status-running",
  Completed: "bg-status-completed",
  Failed: "bg-status-failed",
  Cancelled: "bg-status-cancelled",
};

/**
 * The snapshot draft list's filter: one link per status bucket, each a dot in
 * its status's colour, the label and a mono count, the selected one filled navy. Links rather than tabs because the filter is server-side (`?status=`):
 * a click is a navigation, and `aria-current` marks where you are.
 *
 * The page stays while the next list loads; the link that was clicked shows a
 * spinner once that takes a moment (`LinkPending`).
 *
 * On a phone the control scrolls inside itself; the page never does. `stats` is
 * null when the counts could not be loaded, and the links then go without them
 * rather than showing zeros.
 */
export function DraftListTabs({
  active,
  stats,
  view,
}: {
  /** The selected tab, or undefined when the `?status=` value matches none. */
  active: StatusTab | undefined;
  stats: JobStatsResponse | null;
  /** The page size and order, which a click on a tab keeps. */
  view?: ListView;
}) {
  return (
    <nav aria-label="Filter snapshot drafts" className={SEGMENTED_TRACK}>
      <ul className="flex gap-1">
        {STATUS_TABS.map((tab) => {
          const selected = tab === active;
          return (
            <li key={tab.label} className="shrink-0">
              <Link
                href={listHref(tab.value, 1, view)}
                aria-current={selected ? "page" : undefined}
                className={segmentClass(selected)}
              >
                <span aria-hidden="true" className={segmentDotClass(selected, TAB_DOT[tab.label] ?? "bg-hero")} />
                {tab.label}
                {stats && <span className={segmentCountClass()}>{stats[tab.count]}</span>}
                <LinkPending />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
