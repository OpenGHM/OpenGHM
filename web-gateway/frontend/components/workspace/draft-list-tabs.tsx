import Link from "next/link";
import { LinkPending } from "@/components/ui/link-pending";
import { SEGMENTED_TRACK, segmentClass, segmentCountClass } from "@/components/workspace/segmented";
import { STATUS_TABS, listHref, type StatusTab } from "@/lib/jobs/filters";
import type { JobStatsResponse } from "@/lib/jobs/types";

/**
 * The snapshot draft list's filter, drawn like the Data Repository's List / Grid
 * switch: one link per status bucket in a quiet segmented control, each with its
 * count. Links rather than tabs because the filter is server-side (`?status=`):
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
}: {
  /** The selected tab, or undefined when the `?status=` value matches none. */
  active: StatusTab | undefined;
  stats: JobStatsResponse | null;
}) {
  return (
    <nav aria-label="Filter snapshot drafts" className={SEGMENTED_TRACK}>
      <ul className="flex gap-0.5">
        {STATUS_TABS.map((tab) => {
          const selected = tab === active;
          return (
            <li key={tab.label} className="shrink-0">
              <Link
                href={listHref(tab.value)}
                aria-current={selected ? "page" : undefined}
                className={segmentClass(selected)}
              >
                {tab.label}
                {stats && <span className={segmentCountClass(selected)}>{stats[tab.count]}</span>}
                <LinkPending />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
