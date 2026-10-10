import { PageBody } from "@/components/layout/page-hero";
import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * A workshop's page while it loads: the band with a title bar and, over its
 * edge, the article card and the Details card. Invisible for the first 300 ms.
 */
export default function WorkshopLoading() {
  return (
    <div className="flex min-h-screen flex-col">
      <div className="relative overflow-clip bg-hero pb-[120px] text-hero-foreground">
        <div aria-hidden="true" className="hero-dots pointer-events-none absolute inset-0" />
        <Header variant="overlay" />
        <div
          role="status"
          aria-busy="true"
          aria-label="Loading the workshop"
          className="reveal-delayed relative mx-auto flex w-full max-w-[1360px] flex-col gap-[22px] px-4 pt-6 sm:px-7 lg:pt-10"
        >
          <Skeleton tone="hero" className="h-3.5 w-48" />
          <Skeleton tone="hero" className="h-7 w-44 rounded-full" />
          <Skeleton tone="hero" className="h-11 w-full max-w-[640px]" />
          <Skeleton tone="hero" className="h-4 w-40" />
        </div>
      </div>
      <PageBody className="reveal-delayed flex-1">
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-3.5 rounded-card bg-card p-[clamp(26px,3.6vw,48px)] shadow-raised">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-full max-w-[560px]" />
            <Skeleton className="h-4 w-2/3" />
          </div>
          <div className="space-y-3 rounded-card bg-card p-6 shadow-raised">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </div>
      </PageBody>
      <Footer />
    </div>
  );
}
