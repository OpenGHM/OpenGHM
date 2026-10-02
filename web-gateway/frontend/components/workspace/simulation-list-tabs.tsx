import Link from "next/link";
import { LinkPending } from "@/components/ui/link-pending";
import { STATUS_TABS, listHref, type StatusTab } from "@/lib/jobs/filters";
import type { JobStatsResponse } from "@/lib/jobs/types";

/**
 * The simulation list's filter: one link per status bucket, each with its
 * count. Links rather than tabs because the filter is server-side (`?status=`):
 * a click is a navigation, and `aria-current` marks where you are.
 *
 * The page stays while the next list loads; the link that was clicked shows a
 * spinner once that takes a moment (`LinkPending`).
 *
 * On a phone the bar scrolls inside itself; the page never does. `stats` is
 * null when the counts could not be loaded, and the links then go without them
 * rather than showing zeros.
 */
export function SimulationListTabs({
  active,
  stats,
}: {
  /** The selected tab, or undefined when the `?status=` value matches none. */
  active: StatusTab | undefined;
  stats: JobStatsResponse | null;
}) {
  return (
    <nav
      aria-label="Filter simulations"
      className="w-fit max-w-full overflow-x-auto rounded-lg border bg-white p-1 shadow-xs"
    >
      <ul className="flex gap-1">
        {STATUS_TABS.map((tab) => {
          const selected = tab === active;
          return (
            <li key={tab.label} className="shrink-0">
              <Link
                href={listHref(tab.value)}
                aria-current={selected ? "page" : undefined}
                className={`relative flex min-h-10 items-center gap-2 rounded-md px-3.5 text-sm font-semibold whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${
                  selected
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-slate-100 hover:text-foreground"
                }`}
              >
                {tab.label}
                {stats && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-xs leading-none tabular-nums ${
                      selected ? "bg-white/20" : "bg-slate-100"
                    }`}
                  >
                    {stats[tab.count]}
                  </span>
                )}
                <LinkPending />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
