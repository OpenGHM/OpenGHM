import { Skeleton } from "@/components/ui/skeleton";
import { COLUMNS } from "@/components/workspace/simulation-columns";

/**
 * The list while it loads: the toolbar and five rows, in the shape of what
 * replaces them so nothing jumps. Announced once, as busy, not row by row.
 * Invisible for the first 300 ms, so a fast load never shows it.
 */
export function SimulationListSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading simulations" className="reveal-delayed">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Skeleton className="h-10.5 w-full rounded-xl sm:w-[31rem]" />
        <Skeleton className="hidden h-10.5 w-72 rounded-xl sm:block" />
      </div>
      <div className="mt-4 overflow-hidden rounded-xl border bg-card shadow-sm">
        <div className="hidden h-9 border-b bg-muted/40 sm:block" />
        <div className="divide-y">
          {Array.from({ length: 5 }, (_, i) => (
            <div
              key={i}
              className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3.5 sm:gap-x-4 sm:px-5 ${COLUMNS}`}
            >
              <div className="min-w-0 space-y-2">
                <Skeleton className="h-4 w-2/3 sm:w-1/3" />
                <Skeleton className="h-3 w-3/4 sm:w-1/2" />
              </div>
              <Skeleton className="col-start-1 h-3.5 w-28 sm:col-auto sm:w-20" />
              <Skeleton className="hidden h-3.5 w-16 sm:block" />
              <Skeleton className="col-start-2 row-span-2 row-start-1 size-8 justify-self-end rounded-md sm:col-auto sm:row-auto sm:row-span-1" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
