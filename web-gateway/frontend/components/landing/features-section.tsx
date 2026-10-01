import { LayoutTemplate, Database, Globe, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface Feature {
  icon: LucideIcon;
  title: string;
  description: string;
}

const FEATURES: Feature[] = [
  {
    icon: LayoutTemplate,
    title: "The Gateway",
    description:
      "User-friendly web portal connecting directly to NSF Anvil supercomputer without command-line complexity.",
  },
  {
    icon: Database,
    title: "Data Repository",
    description:
      "Access vast repository of GHM-ready input data (ZARR format) hosted in high-availability cloud storage.",
  },
  {
    icon: Globe,
    title: "Community Model",
    description:
      "Run containerized, reproducible state-of-the-art hydrologic models instantly.",
  },
  {
    icon: Wrench,
    title: "The Toolkit",
    description:
      "Powerful Python APIs for data processing, spatial resampling, and interactive visualization notebooks.",
  },
];

export function FeaturesSection() {
  return (
    <section className="bg-muted py-16 lg:py-30">
      <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-10">
        <div className="mx-auto mb-10 max-w-[760px] lg:mb-20 text-center">
          <span className="mb-4 block text-sm font-bold uppercase tracking-widest text-primary">
            Core Capabilities
          </span>
          <h2 className="mb-6 text-3xl font-extrabold leading-tight sm:text-4xl lg:text-[42px] tracking-tight text-[#0f172a]">
            A Comprehensive Platform for Hydrology
          </h2>
          <p className="text-lg leading-relaxed text-slate-600">
            Everything you need to conduct state-of-the-art water research in
            one place, powered by NSF Anvil Cyberinfrastructure.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="flex cursor-pointer flex-col items-start gap-5 min-w-0 rounded-lg bg-white p-6 sm:p-8 lg:p-10 lg:pb-8 shadow-[0_4px_6px_-1px_rgba(0,0,0,0.05),0_2px_4px_-1px_rgba(0,0,0,0.03)] transition-all hover:-translate-y-1 hover:shadow-[0_12px_24px_-8px_rgba(0,0,0,0.1)]"
            >
              <div className="mb-2 flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary text-primary">
                <feature.icon className="h-8 w-8" />
              </div>
              <h3 className="text-[22px] font-bold text-[#0f172a]">
                {feature.title}
              </h3>
              <p className="text-base leading-relaxed text-slate-500">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
