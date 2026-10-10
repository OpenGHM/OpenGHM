import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * A page header's worth of bars (a title and a line under it), then the content.
 * The console's frame is already on screen, so a page that is still loading
 * only has to stand in for its own header and body. Announced once; all of it
 * is invisible for the first 300 ms, so a fast load shows none.
 */
export function LoadingPage({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" aria-busy="true" aria-label="Loading" className="reveal-delayed space-y-6">
      <div className="space-y-2.5">
        <Skeleton className="h-8 w-48 max-w-full" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      {children}
    </div>
  );
}

/** Overview and system: a row of figures, then a few cards. */
export function OverviewSkeleton() {
  return (
    <LoadingPage>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Card key={i}>
            <CardContent className="space-y-2 py-4">
              <Skeleton className="h-7 w-12" />
              <Skeleton className="h-4 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }, (_, i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-5 w-40" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-32 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    </LoadingPage>
  );
}

/** Users, jobs, audit log and a user's page: a header, filters, then rows. */
export function ListSkeleton() {
  return (
    <LoadingPage>
      <Skeleton className="h-9 w-full max-w-sm" />
      <Card>
        <CardContent className="divide-y p-0">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-4 sm:px-6">
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3 sm:w-1/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
              <Skeleton className="hidden h-5 w-20 rounded-full sm:block" />
              <Skeleton className="hidden h-4 w-32 sm:block" />
            </div>
          ))}
        </CardContent>
      </Card>
    </LoadingPage>
  );
}
