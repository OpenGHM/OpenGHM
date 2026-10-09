import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SectionEyebrow, SectionTitle } from "./section-parts";

export function ChallengeSection() {
  return (
    <section className="flex flex-wrap gap-3 rounded-panel bg-card p-3 shadow-raised">
      <div className="flex flex-[999_1_420px] flex-col justify-center gap-[18px] px-5 py-9 sm:px-10 sm:py-11">
        <SectionEyebrow>The Challenge</SectionEyebrow>
        <SectionTitle>Bridging the Gap in Water Science</SectionTitle>
        <p className="max-w-[560px] text-[16.5px] leading-[1.65] text-pretty text-muted-foreground">
          OpenGHM removes technical barriers to storing, accessing, and running
          the data and code that enables large-scale hydrologic modeling. We
          provide a unified, cloud-native platform that integrates data,
          compute, and visualization.
        </p>
        <Link
          href="/about"
          className="mt-1.5 inline-flex items-center gap-2 self-start rounded-[11px] bg-muted px-4 py-[11px] text-sm font-semibold text-foreground transition-colors hover:bg-secondary hover:text-primary focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          Read our Mission Statement
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </div>

      <div className="flex-[1_1_360px] self-center overflow-hidden rounded-[20px] bg-accent">
        <Image
          src="/images/challenge.jpg"
          alt="Simplifying Complexity"
          width={600}
          height={450}
          sizes="(min-width: 1024px) 40vw, 100vw"
          className="block h-auto w-full"
        />
      </div>
    </section>
  );
}
