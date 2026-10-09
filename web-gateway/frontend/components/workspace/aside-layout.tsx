import type { ReactNode } from "react";

/**
 * The content of a Workspace page with a column beside it from `xl`: the page's
 * content and, to its right, an `aside` 20 rem wide and 20 px away. It fills the
 * `PageBody` it sits in, so both columns start on the navy band's overlap.
 *
 * What the aside does is the page's choice (`below`):
 *
 * - `hidden`: below `xl` it is not there; the page offers its content another
 *   way (the draft wizard's "Help" button opens it in a sheet). From `xl` it is
 *   `sticky` 20 px from the top of the viewport (the site header scrolls away
 *   with the band) and scrolls by itself when the viewport is shorter than it.
 * - `flow`: below `xl` it is in the page, after `lead` and before `children`, a
 *   block of its own the width of the content. Put what must stay first on a
 *   narrow screen in `lead`; from `xl` `lead` and `children` are one column and
 *   the aside is the column beside both. It scrolls with the page: a column of
 *   cards (the job page's Run details and Execution) is taller than a viewport,
 *   and a sticky one would clip its last card.
 *
 * `lead` is only for `flow`.
 */
export function AsideLayout({
  aside,
  label,
  below,
  lead,
  children,
}: {
  aside: ReactNode;
  /** The aside's accessible name (a `complementary` landmark). */
  label: string;
  below: "hidden" | "flow";
  /** `flow` only: what comes before the aside on a narrow screen. */
  lead?: ReactNode;
  children: ReactNode;
}) {
  if (below === "hidden") {
    return (
      <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_20rem] xl:gap-5">
        <div className="min-w-0">{children}</div>
        <aside
          aria-label={label}
          className="hidden xl:sticky xl:top-5 xl:block xl:max-h-[calc(100dvh-2.5rem)] xl:self-start xl:overflow-y-auto"
        >
          {aside}
        </aside>
      </div>
    );
  }

  // Below xl one column: lead, aside, children. From xl two rows in the first
  // column (lead, then children) with the aside in the second column across
  // both, which is what keeps it beside the whole page.
  return (
    <div className="flex flex-col gap-5 xl:grid xl:grid-cols-[minmax(0,1fr)_20rem] xl:grid-rows-[auto_1fr]">
      {lead !== undefined && <div className="min-w-0 xl:col-start-1 xl:row-start-1">{lead}</div>}
      <aside
        aria-label={label}
        className="min-w-0 xl:col-start-2 xl:row-span-2 xl:row-start-1 xl:self-start"
      >
        {aside}
      </aside>
      <div className="min-w-0 space-y-5 xl:col-start-1 xl:row-start-2">{children}</div>
    </div>
  );
}
