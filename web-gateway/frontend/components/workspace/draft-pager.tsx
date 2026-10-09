import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { LinkPending } from "@/components/ui/link-pending";
import { PAGE_SIZES, listHref, type ListSort } from "@/lib/jobs/filters";
import { pageWindow } from "@/lib/jobs/page-window";
import { cn } from "@/lib/utils";

const ARROW =
  "relative grid size-10 place-items-center rounded-xl border bg-card text-foreground outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:size-[42px]";
const NUMBER =
  "relative grid h-10 min-w-10 place-items-center rounded-xl px-2.5 font-mono text-sm font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:h-[42px] sm:min-w-[42px]";

/**
 * The list's pager, one white card: rows per page, which rows these are ("11–20
 * of 23"), and Previous, the page numbers and Next. All links: the page, the
 * page size and the order are in the URL (`listHref`), and a change of size
 * starts again from the first page. An end of the list is a disabled button,
 * not a gap. The link that was clicked shows a spinner once the next page
 * takes a moment (`LinkPending`).
 */
export function DraftPager({
  page,
  totalPages,
  totalCount,
  pageSize,
  status,
  sort,
}: {
  page: number;
  totalPages: number;
  totalCount: number;
  pageSize: number;
  status: string | undefined;
  sort: ListSort;
}) {
  const href = (p: number, size = pageSize) => listHref(status, p, { size, sort });
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, totalCount);

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3 rounded-[18px] bg-card p-3 text-card-foreground shadow-card sm:pl-[22px]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13.5px] text-muted-foreground">
        <nav aria-label="Rows per page" className="flex items-center gap-3">
          <span>Rows per page</span>
          <ul className="flex gap-0.5 rounded-xl bg-muted p-1">
            {PAGE_SIZES.map((size) => {
              const selected = size === pageSize;
              return (
                <li key={size}>
                  <Link
                    href={href(1, size)}
                    aria-current={selected ? "true" : undefined}
                    className={cn(
                      "relative grid min-h-10 min-w-[38px] place-items-center rounded-[9px] px-2.5 font-mono text-[13px] outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:min-h-8",
                      selected ? "bg-hero text-white" : "text-foreground/80 hover:bg-card",
                    )}
                  >
                    {size}
                    <LinkPending className="top-0.5 right-0.5 size-3" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <span className="font-mono text-foreground">
          {first}&ndash;{last} of {totalCount}
        </span>
      </div>

      {totalPages > 1 && (
        <nav aria-label="Pages" className="flex items-center gap-1.5">
          {page > 1 ? (
            <Link href={href(page - 1)} aria-label="Previous page" title="Previous page" className={cn(ARROW, "hover:bg-secondary hover:text-primary")}>
              <ChevronLeft className="size-[15px]" aria-hidden="true" />
              <LinkPending className="top-0.5 right-0.5 size-3" />
            </Link>
          ) : (
            <button type="button" disabled aria-disabled="true" aria-label="Previous page" className={cn(ARROW, "opacity-40")}>
              <ChevronLeft className="size-[15px]" aria-hidden="true" />
            </button>
          )}

          {pageWindow(page, totalPages).map((p, i) =>
            p === null ? (
              <span key={`gap-${i}`} aria-hidden="true" className="px-1 font-mono text-muted-foreground">
                &hellip;
              </span>
            ) : p === page ? (
              <span key={p} aria-current="page" aria-label={`Page ${p} of ${totalPages}`} className={cn(NUMBER, "bg-hero text-white")}>
                {p}
              </span>
            ) : (
              <Link
                key={p}
                href={href(p)}
                aria-label={`Page ${p}`}
                className={cn(NUMBER, "text-foreground/80 hover:bg-secondary hover:text-primary")}
              >
                {p}
                <LinkPending className="top-0.5 right-0.5 size-3" />
              </Link>
            ),
          )}

          {page < totalPages ? (
            <Link href={href(page + 1)} aria-label="Next page" title="Next page" className={cn(ARROW, "hover:bg-secondary hover:text-primary")}>
              <ChevronRight className="size-[15px]" aria-hidden="true" />
              <LinkPending className="top-0.5 right-0.5 size-3" />
            </Link>
          ) : (
            <button type="button" disabled aria-disabled="true" aria-label="Next page" className={cn(ARROW, "opacity-40")}>
              <ChevronRight className="size-[15px]" aria-hidden="true" />
            </button>
          )}
        </nav>
      )}
    </div>
  );
}
