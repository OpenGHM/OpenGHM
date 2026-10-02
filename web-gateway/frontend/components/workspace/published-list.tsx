import Link from "next/link";
import { AlertCircle, PackageOpen } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CARD_GRID_CLASS, CatalogueCard, CatalogueCardSkeleton } from "@/components/repository/catalogue-card";
import type { CatalogueItem } from "@/lib/repository/types";

// The cards are shown as a grid, where a card has no tag or keyword buttons to
// press; there is no filter here for them to feed.
const NO_FILTER = () => {};

/** What the user published: a count, then the catalogue's own cards in its grid. */
export function PublishedList({ items }: { items: CatalogueItem[] }) {
  if (items.length === 0) {
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

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{items.length} published</p>
      <ul className={CARD_GRID_CLASS}>
        {items.map((item) => (
          <li key={`${item.kind}:${item.id}`} className="min-w-0">
            <CatalogueCard
              item={item}
              view="grid"
              onToggleTag={NO_FILTER}
              onToggleKeyword={NO_FILTER}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The list could not be loaded: says so and offers the same page again. */
export function PublishedLoadError({ retryHref }: { retryHref: string }) {
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

/** The list while it loads: the count line and six cards, in the grid's shape. */
export function PublishedListSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading published artifacts" className="space-y-3">
      <Skeleton className="h-3 w-20" />
      <div className={CARD_GRID_CLASS}>
        {Array.from({ length: 6 }, (_, i) => (
          <CatalogueCardSkeleton key={i} view="grid" />
        ))}
      </div>
    </div>
  );
}
