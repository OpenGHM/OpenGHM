import { PageBody } from "@/components/layout/page-hero";
import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";
import { Skeleton } from "@/components/ui/skeleton";

/** The news page while it loads: the band with a title bar and a row of cards. Invisible for the first 300 ms. */
export default function NewsLoading() {
  return (
    <div className="flex min-h-screen flex-col">
      <div className="relative overflow-clip bg-hero pb-[120px] text-hero-foreground">
        <div aria-hidden="true" className="hero-dots pointer-events-none absolute inset-0" />
        <Header variant="overlay" />
        <div
          role="status"
          aria-busy="true"
          aria-label="Loading the updates"
          className="reveal-delayed relative mx-auto flex w-full max-w-[1360px] flex-col gap-[22px] px-4 pt-6 sm:px-7 lg:pt-10"
        >
          <Skeleton tone="hero" className="h-3.5 w-48" />
          <Skeleton tone="hero" className="h-11 w-full max-w-[360px]" />
          <Skeleton tone="hero" className="h-4 w-full max-w-[420px]" />
        </div>
      </div>
      <PageBody className="reveal-delayed flex-1">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] gap-3.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-3 rounded-card bg-card p-2">
              <Skeleton className="aspect-[16/10] w-full rounded-2xl" />
              <Skeleton className="mx-3.5 h-5 w-24 rounded-full" />
              <Skeleton className="mx-3.5 h-5 w-3/4" />
              <Skeleton className="mx-3.5 mb-3 h-4 w-2/3" />
            </div>
          ))}
        </div>
      </PageBody>
      <Footer />
    </div>
  );
}
