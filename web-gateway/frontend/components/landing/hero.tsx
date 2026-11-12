import { PageHero } from "@/components/layout/page-hero";
import { ExploreRepositoryButton } from "@/components/landing/explore-repository-button";
import { OpenWorkspaceButton } from "@/components/landing/open-workspace-button";

export function Hero() {
  return (
    <PageHero
      eyebrow="FAIR Cyberinfrastructure for Global Hydrologic Modeling"
      // Home's title is larger than PageHero's display size (72 px): the span
      // restates size, leading and tracking, since the h1's em letter-spacing
      // is already resolved at the smaller size.
      title={
        <span className="text-[clamp(44px,7vw,88px)] leading-[0.96] tracking-[-0.045em]">
          Democratizing Global Hydrologic Modeling
        </span>
      }
      subtitle="Make water sustainability research FAIR. Access high-performance computing and massive datasets directly via your browser."
      backgroundImage={{ src: "/images/hero-bg.jpg", alt: "Global Hydrology Visualization" }}
      contentClassName="gap-7 pt-16 lg:pt-[104px]"
      className="pb-[136px]"
      actions={
        <>
          <ExploreRepositoryButton className="shadow-float" />
          <OpenWorkspaceButton />
        </>
      }
    />
  );
}
