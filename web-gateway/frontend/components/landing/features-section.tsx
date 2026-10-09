import { PanelDots, SectionEyebrow, SectionTitle } from "./section-parts";

interface Feature {
  title: string;
  description: string;
}

const FEATURES: Feature[] = [
  {
    title: "The Gateway",
    description:
      "User-friendly web portal connecting directly to NSF Anvil supercomputer without command-line complexity.",
  },
  {
    title: "Data Repository",
    description:
      "Access vast repository of GHM-ready input data (ZARR format) hosted in high-availability cloud storage.",
  },
  {
    title: "Community Model",
    description:
      "Run containerized, reproducible state-of-the-art hydrologic models instantly.",
  },
  {
    title: "The Toolkit",
    description:
      "Powerful Python APIs for data processing, spatial resampling, and interactive visualization notebooks.",
  },
];

export function FeaturesSection() {
  return (
    <section className="relative overflow-hidden rounded-panel bg-hero px-6 pt-12 pb-6 text-white sm:px-12 sm:pt-16 sm:pb-8">
      <PanelDots alpha={0.06} fade />
      <div className="relative flex flex-wrap gap-x-16 gap-y-10">
        <div className="flex max-w-[420px] flex-[1_1_320px] flex-col gap-[18px]">
          <SectionEyebrow tone="dark">Core Capabilities</SectionEyebrow>
          <SectionTitle>A Comprehensive Platform for Hydrology</SectionTitle>
          <p className="text-base leading-[1.6] text-pretty text-hero-foreground-muted">
            Everything you need to conduct state-of-the-art water research in
            one place, powered by NSF Anvil Cyberinfrastructure.
          </p>
        </div>

        <div className="grid flex-[999_1_480px] grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-x-12">
          {FEATURES.map((feature, i) => (
            <div
              key={feature.title}
              className="grid grid-cols-[40px_minmax(0,1fr)] items-baseline gap-x-5 gap-y-1 border-t border-white/[0.14] pt-8 pb-9 sm:grid-cols-[56px_minmax(0,1fr)]"
            >
              <span
                aria-hidden="true"
                className="font-mono text-[13px] text-hero-eyebrow"
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="text-[26px] leading-[1.2] font-semibold tracking-[-0.025em]">
                {feature.title}
              </h3>
              <p className="col-start-2 mt-2.5 max-w-[440px] text-[15.5px] leading-[1.65] text-pretty text-hero-foreground-muted">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
