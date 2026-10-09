import type { ReactNode } from "react";
import { WIDE_CONTAINER } from "@/components/workspace/page-header";
import { cn } from "@/lib/utils";

/**
 * The body of a Workspace page with a column beside it from `xl`: the page's
 * content in the wide container (`WIDE_CONTAINER`, the header's own) and, to
 * its right, an `aside` 20 rem wide and 2 rem away, `sticky` just under the
 * site header (81 px at `lg` and up, so `top-24` leaves a gap) that scrolls by
 * itself when the viewport is shorter than it. The content takes the rest of
 * the width, up to 1024 px.
 *
 * What the aside does below `xl` is the page's choice (`below`):
 *
 * - `hidden`: it is not there; the page offers its content another way (the
 *   draft wizard's "Help" button opens it in a sheet).
 * - `flow`: it is in the page, after `lead` and before `children`, a block of
 *   its own the width of the content. Put what must stay first on a narrow
 *   screen in `lead`; from `xl` `lead` and `children` are one column and the
 *   aside is the column beside both.
 *
 * `lead` is only for `flow`.
 */
export function AsideLayout({
  aside,
  label,
  below,
  lead,
  className,
  children,
}: {
  aside: ReactNode;
  /** The aside's accessible name (a `complementary` landmark). */
  label: string;
  below: "hidden" | "flow";
  /** `flow` only: what comes before the aside on a narrow screen. */
  lead?: ReactNode;
  /** The vertical padding of the body. */
  className?: string;
  children: ReactNode;
}) {
  const column =
    "xl:sticky xl:top-24 xl:max-h-[calc(100dvh-7rem)] xl:self-start xl:overflow-y-auto";

  if (below === "hidden") {
    return (
      <div className={cn("flex-1", className)}>
        <div className={WIDE_CONTAINER}>
          <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_20rem] xl:gap-8">
            <div className="min-w-0">{children}</div>
            <aside aria-label={label} className={cn("hidden xl:block", column)}>
              {aside}
            </aside>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex-1", className)}>
      <div className={WIDE_CONTAINER}>
        {/* Below xl one column: lead, aside, children. From xl two rows in the
            first column (lead, then children) with the aside in the second
            column across both, which is what keeps it beside the whole page. */}
        <div className="flex flex-col gap-8 xl:grid xl:grid-cols-[minmax(0,1fr)_20rem] xl:grid-rows-[auto_1fr] xl:gap-x-8">
          {lead !== undefined && <div className="min-w-0 xl:col-start-1 xl:row-start-1">{lead}</div>}
          <aside
            aria-label={label}
            className={cn("min-w-0 xl:col-start-2 xl:row-span-2 xl:row-start-1", column)}
          >
            {aside}
          </aside>
          <div className="min-w-0 space-y-8 xl:col-start-1 xl:row-start-2">{children}</div>
        </div>
      </div>
    </div>
  );
}
