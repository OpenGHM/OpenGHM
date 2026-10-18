import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { OpenWorkspaceButton } from "@/components/landing/open-workspace-button";
import { PanelDots, SectionTitle } from "./section-parts";

export function CtaSection() {
  return (
    <section className="relative flex flex-wrap items-center justify-between gap-8 overflow-hidden rounded-panel bg-hero px-6 py-14 text-white sm:px-12 sm:py-[72px]">
      <PanelDots alpha={0.08} />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-[180px] -right-[120px] size-[520px] rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--hero-glow)_30%,transparent),transparent_65%)]"
      />
      <div className="relative flex max-w-[640px] flex-col gap-4">
        <SectionTitle className="text-[clamp(32px,4vw,48px)]">
          Ready to Accelerate Your Research?
        </SectionTitle>
        <p className="text-[17px] leading-[1.6] text-pretty text-hero-foreground-muted">
          Find published snapshots and model inputs, and run hydrologic models on
          NSF Anvil from your browser. Get started today.
        </p>
      </div>
      <div className="relative flex flex-wrap gap-2.5">
        <Button asChild size="xl">
          <Link href="/repository">
            Explore Data Repository
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
        <OpenWorkspaceButton />
      </div>
    </section>
  );
}
