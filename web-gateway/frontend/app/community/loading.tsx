import { PageBody } from "@/components/layout/page-hero";
import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The Community page while it loads: the band with the heading and the tabs
 * as bars, and a card and a few rows in the shape of the workshops. Invisible
 * for the first 300 ms (`reveal-delayed`), so a fast load shows no placeholder.
 */
export default function CommunityLoading() {
  return (
    <div className="flex min-h-screen flex-col">
      <div className="relative overflow-clip bg-hero pb-[120px] text-hero-foreground">
        <div aria-hidden="true" className="hero-dots pointer-events-none absolute inset-0" />
        <Header variant="overlay" />
        <div
          role="status"
          aria-busy="true"
          aria-label="Loading the Community page"
          className="reveal-delayed relative mx-auto flex w-full max-w-[1360px] flex-col gap-[22px] px-4 pt-6 sm:px-7 lg:pt-10"
        >
          <Skeleton tone="hero" className="h-3 w-24" />
          <Skeleton tone="hero" className="h-11 w-full max-w-[560px]" />
          <Skeleton tone="hero" className="h-5 w-full max-w-[420px]" />
          <Skeleton tone="hero" className="h-[50px] w-full max-w-[420px] rounded-[14px]" />
        </div>
      </div>
      <PageBody className="reveal-delayed flex flex-1 flex-col gap-4" as="main">
        <div className="grid overflow-hidden rounded-card bg-card shadow-raised md:grid-cols-2">
          <Skeleton className="aspect-[4/3] rounded-none" />
          <div className="flex flex-col gap-4 px-5 py-6 sm:px-[30px]">
            <Skeleton className="h-6 w-40 rounded-full" />
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-4 w-full max-w-[520px]" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-14 w-full max-w-[360px] rounded-xl" />
          </div>
        </div>
        <Skeleton className="mt-5 h-7 w-48" />
        {[0, 1].map((i) => (
          <div key={i} className="flex items-center gap-[22px] rounded-[18px] bg-card py-3.5 pr-5 pl-3.5">
            <Skeleton className="size-[72px] shrink-0 rounded-[14px]" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </PageBody>
      <Footer />
    </div>
  );
}
