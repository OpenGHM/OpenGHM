import { Skeleton } from "@/components/ui/skeleton";
import { COLUMNS } from "@/components/workspace/draft-columns";
import { HEADER_ROW, ROW_CARD } from "@/components/workspace/list-card";
import { ListToolbar } from "@/components/workspace/list-toolbar";
import { cn } from "@/lib/utils";

/**
 * The list while it loads: the toolbar and five row cards, in the shape of
 * what replaces them so nothing jumps. Announced once, as busy, not row by
 * row. Invisible for the first 300 ms, so a fast load never shows it.
 */
export function DraftListSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading snapshot drafts" className="reveal-delayed">
      <ListToolbar>
        <Skeleton className="h-10 w-full rounded-[11px] lg:w-[31rem]" />
        <Skeleton className="hidden h-[42px] w-72 rounded-xl lg:block" />
      </ListToolbar>
      <div className="mt-4 flex flex-col gap-3.5">
        <div aria-hidden="true" className={cn(HEADER_ROW, "h-5")} />
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }, (_, i) => (
            <div
              key={i}
              className={cn(
                ROW_CARD,
                "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2.5 px-4 py-3.5 hover:translate-y-0 hover:border-transparent hover:shadow-none sm:px-5 sm:py-4 lg:gap-x-4",
                COLUMNS,
              )}
            >
              <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                <Skeleton className="size-10 shrink-0 rounded-[14px] sm:size-[46px]" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-2/3 lg:w-1/3" />
                  <Skeleton className="h-3 w-3/4 lg:w-1/2" />
                </div>
              </div>
              <Skeleton className="col-span-2 ml-[52px] h-5 w-28 rounded-full sm:ml-[62px] lg:col-auto lg:ml-0 lg:h-3.5 lg:w-20 lg:rounded-md" />
              <Skeleton className="hidden h-6 w-24 rounded-full lg:block" />
              <Skeleton className="hidden h-3.5 w-16 lg:block" />
              <Skeleton className="col-start-2 row-start-1 size-8 justify-self-end rounded-[10px] lg:col-auto lg:row-auto" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
