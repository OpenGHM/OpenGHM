import { PageBody } from "@/components/layout/page-hero";
import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";
import { Skeleton } from "@/components/ui/skeleton";

/** A news post's page while it loads: the band with a title bar and the article card. Invisible for the first 300 ms. */
export default function NewsPostLoading() {
  return (
    <div className="flex min-h-screen flex-col">
      <div className="relative overflow-clip bg-hero pb-[120px] text-hero-foreground">
        <div aria-hidden="true" className="hero-dots pointer-events-none absolute inset-0" />
        <Header variant="overlay" />
        <div
          role="status"
          aria-busy="true"
          aria-label="Loading the post"
          className="reveal-delayed relative mx-auto flex w-full max-w-[1360px] flex-col gap-[22px] px-4 pt-6 sm:px-7 lg:pt-10"
        >
          <Skeleton tone="hero" className="h-3.5 w-48" />
          <Skeleton tone="hero" className="h-11 w-full max-w-[560px]" />
          <Skeleton tone="hero" className="h-4 w-full max-w-[420px]" />
        </div>
      </div>
      <PageBody className="reveal-delayed flex-1">
        <div className="space-y-3.5 rounded-card bg-card p-[clamp(26px,3.6vw,48px)] shadow-raised">
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-4 w-full max-w-[560px]" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </PageBody>
      <Footer />
    </div>
  );
}
