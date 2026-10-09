import Link from "next/link";
import { AlertCircle, PackageOpen } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ListToolbar } from "@/components/workspace/list-toolbar";

/** The caller has no snapshot or model input at all: says so, with no button. */
export function MyDataEmpty() {
  return (
    <div className="rounded-card border border-dashed bg-card px-4 py-16 text-center shadow-raised sm:py-20">
      <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-muted">
        <PackageOpen className="size-6 text-muted-foreground" aria-hidden="true" />
      </div>
      <p className="mb-1 text-sm font-medium text-foreground">Nothing published yet</p>
      <p className="mx-auto max-w-sm text-sm text-muted-foreground">
        When a snapshot draft&apos;s simulation finishes, you will be able to publish it as a model snapshot from
        its page.
      </p>
    </div>
  );
}

/** The list could not be loaded: says so and offers the same page again. */
export function MyDataLoadError({ retryHref }: { retryHref: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-card border border-destructive/25 bg-card p-5 text-sm text-destructive shadow-raised"
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
 * The list while it loads: the toolbar and five rows, in the shape of what
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
      <ListToolbar>
        <Skeleton className="h-[46px] w-full rounded-[11px] sm:w-[26rem]" />
        <Skeleton className="hidden h-[46px] w-72 rounded-[11px] sm:block" />
      </ListToolbar>
      <div className="mt-4 overflow-hidden rounded-card border border-border/70 bg-card shadow-card">
        <div className="hidden h-10 border-b bg-muted/60 sm:block" />
        <div className="divide-y">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-4 sm:px-6">
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3 sm:w-1/2" />
                <Skeleton className="h-3 w-1/2 sm:w-1/3" />
              </div>
              <Skeleton className="hidden h-4 w-28 sm:block" />
              <Skeleton className="hidden h-4 w-16 sm:block" />
              <Skeleton className="hidden h-4 w-20 md:block" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
