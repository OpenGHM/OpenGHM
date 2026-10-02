import { Header } from "@/components/landing/header";
import { Footer } from "@/components/landing/footer";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** A card in the detail page's shape: a header row and a few lines. */
function CardSkeleton({ lines }: { lines: number }) {
  return (
    <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
      <div className="flex items-center gap-2 border-b px-6 py-4">
        <Skeleton className="size-8 rounded-lg" />
        <Skeleton className="h-5 w-40" />
      </div>
      <CardContent className="space-y-3 pt-5 pb-6">
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} className={`h-4 ${i === lines - 1 ? "w-2/3" : "w-full"}`} />
        ))}
      </CardContent>
    </Card>
  );
}

/**
 * Shown while a job's page is fetched: the hero and two columns of cards where
 * they will be, so nothing jumps when the data arrives. The Header and Footer
 * are there at once; the skeleton between them is invisible for the first
 * 300 ms (`reveal-delayed`), so a fast load shows no placeholder at all.
 */
export default function JobDetailLoading() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <div className="reveal-delayed flex flex-1 flex-col">
        <div className="border-b bg-muted/50">
          <div className="mx-auto max-w-[1280px] px-4 py-3 sm:px-10">
            <Skeleton className="h-4 w-56" />
          </div>
        </div>

        <div
          className="bg-gradient-to-r from-hero to-primary py-8"
          role="status"
          aria-label="Loading simulation"
        >
          <div className="mx-auto flex max-w-[1280px] flex-col gap-5 px-4 sm:flex-row sm:items-start sm:justify-between sm:px-10">
            <div className="space-y-3">
              <Skeleton className="h-7 w-72 max-w-full bg-white/20" />
              <Skeleton className="h-4 w-48 bg-white/15" />
            </div>
            <Skeleton className="h-10 w-full bg-white/20 sm:w-44" />
          </div>
        </div>

        <main className="flex-1 bg-slate-50">
          <div className="mx-auto max-w-[1280px] px-4 py-10 sm:px-10">
            <Skeleton className="mb-6 h-8 w-44" />
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_340px]">
              <div className="space-y-8">
                <CardSkeleton lines={4} />
                <CardSkeleton lines={3} />
                <CardSkeleton lines={5} />
              </div>
              <div className="space-y-6">
                <CardSkeleton lines={4} />
                <CardSkeleton lines={3} />
              </div>
            </div>
          </div>
        </main>
      </div>

      <Footer />
    </div>
  );
}
