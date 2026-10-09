import Link from "next/link";
import { AlertCircle, PackageOpen } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { HEADER_ROW, ListEmptyCard, ROW_CARD } from "@/components/workspace/list-card";
import { ListToolbar } from "@/components/workspace/list-toolbar";
import { cn } from "@/lib/utils";

/** The caller has no snapshot or model input at all: says so, with no button. */
export function MyDataEmpty() {
  return (
    <ListEmptyCard
      dashed
      className="shadow-raised"
      icon={<PackageOpen />}
      title="Nothing published yet"
      hint={
        <>
          When a snapshot draft&apos;s simulation finishes, you will be able to publish it as a model snapshot from
          its page.
        </>
      }
    />
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
 * The list while it loads: the toolbar and five row cards, in the shape of what
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
        <Skeleton className="h-10 w-full rounded-[11px] lg:w-[26rem]" />
        <Skeleton className="hidden h-[42px] w-72 rounded-xl lg:block" />
      </ListToolbar>
      <div className="mt-4 flex flex-col gap-3.5">
        <div aria-hidden="true" className={cn(HEADER_ROW, "h-5")} />
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }, (_, i) => (
            <div
              key={i}
              className={cn(ROW_CARD, "flex items-center gap-3 px-4 py-3.5 hover:translate-y-0 hover:border-transparent hover:shadow-none sm:gap-4 sm:px-5 sm:py-4")}
            >
              <Skeleton className="size-10 shrink-0 rounded-[14px] sm:size-[46px]" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3 sm:w-1/2" />
                <Skeleton className="h-3 w-1/2 sm:w-1/3" />
              </div>
              <Skeleton className="hidden h-4 w-28 lg:block" />
              <Skeleton className="hidden h-4 w-16 lg:block" />
              <Skeleton className="hidden h-4 w-20 lg:block" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
