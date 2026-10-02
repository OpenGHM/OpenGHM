import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The list while it loads: the tab bar and five rows, in the shape of what
 * replaces them so nothing jumps. Announced once, as busy, not row by row.
 * Invisible for the first 300 ms, so a fast load never shows it.
 */
export function SimulationListSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading simulations" className="reveal-delayed">
      <Skeleton className="h-12 w-full max-w-[34rem] rounded-lg" />
      <Skeleton className="mt-4 mb-2 h-3 w-36" />
      <Card className="py-0">
        <CardContent className="divide-y p-0">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-4 sm:px-6">
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3 sm:w-1/3" />
                <Skeleton className="h-3 w-1/2 sm:hidden" />
              </div>
              <Skeleton className="hidden h-5 w-20 rounded-full sm:block" />
              <Skeleton className="hidden h-4 w-40 sm:block" />
              <Skeleton className="hidden h-4 w-16 sm:block" />
              <Skeleton className="size-8 shrink-0 rounded-md" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
