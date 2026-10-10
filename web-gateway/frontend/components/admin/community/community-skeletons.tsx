import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadingPage } from "@/components/admin/admin-skeletons";

/** The overview: a row of figure cards. */
export function CommunityOverviewSkeleton() {
  return (
    <LoadingPage>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Card key={i}>
            <CardContent className="space-y-3 py-4">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-4 w-3/4" />
            </CardContent>
          </Card>
        ))}
      </div>
    </LoadingPage>
  );
}

/** A list page: rows in a card. */
export function CommunityListSkeleton() {
  return (
    <LoadingPage>
      <Card>
        <CardContent className="divide-y p-0">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-4 sm:px-6">
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3 sm:w-1/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
              <Skeleton className="hidden h-5 w-20 rounded-full sm:block" />
              <Skeleton className="hidden h-4 w-28 sm:block" />
            </div>
          ))}
        </CardContent>
      </Card>
    </LoadingPage>
  );
}

/** An editor: cards of fields. */
export function CommunityEditorSkeleton() {
  return (
    <LoadingPage>
      {Array.from({ length: 3 }, (_, i) => (
        <Card key={i}>
          <CardHeader>
            <Skeleton className="h-5 w-40" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-20 w-full" />
          </CardContent>
        </Card>
      ))}
    </LoadingPage>
  );
}

/** The media library: a grid of tiles. */
export function CommunityFilesSkeleton() {
  return (
    <LoadingPage>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Card key={i} className="gap-3 py-3">
            <CardContent className="space-y-2 px-3">
              <Skeleton className="aspect-[4/3] w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </CardContent>
          </Card>
        ))}
      </div>
    </LoadingPage>
  );
}
