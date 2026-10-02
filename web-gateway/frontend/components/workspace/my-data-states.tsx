import Link from "next/link";
import { AlertCircle, PackageOpen } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** The caller has no snapshot or model input at all: says so, with no button. */
export function MyDataEmpty() {
  return (
    <Card className="border-dashed">
      <CardContent className="py-16 text-center sm:py-20">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
          <PackageOpen className="size-7 text-primary" aria-hidden="true" />
        </div>
        <p className="mb-1 text-sm font-medium text-foreground">Nothing published yet</p>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          When a simulation finishes, you will be able to publish it as a model snapshot from
          its page.
        </p>
      </CardContent>
    </Card>
  );
}

/** The list could not be loaded: says so and offers the same page again. */
export function MyDataLoadError({ retryHref }: { retryHref: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="space-y-1">
        <p className="font-medium">Couldn&apos;t load what you published.</p>
        <p>
          Nothing was changed.{" "}
          <Link href={retryHref} className="font-medium underline underline-offset-2">
            Try again
          </Link>
        </p>
      </div>
    </div>
  );
}

/**
 * The list while it loads: the tab bar and five rows, in the shape of what
 * replaces them so nothing jumps. Announced once, as busy, not row by row.
 * Invisible for the first 300 ms, so a fast load never shows it.
 */
export function MyDataSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading snapshots and inputs"
      className="reveal-delayed"
    >
      <Skeleton className="h-12 w-full max-w-[26rem] rounded-lg" />
      <Skeleton className="mt-4 mb-2 h-3 w-44" />
      <Card className="py-0">
        <CardContent className="divide-y p-0">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-4 sm:px-6">
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3 sm:w-1/2" />
                <Skeleton className="h-3 w-20" />
              </div>
              <Skeleton className="hidden h-5 w-28 rounded-md sm:block" />
              <Skeleton className="hidden h-5 w-16 rounded-md sm:block" />
              <Skeleton className="hidden h-4 w-32 md:block" />
              <Skeleton className="hidden h-4 w-20 md:block" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
