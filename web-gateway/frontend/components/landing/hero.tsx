import Image from "next/image";
import Link from "next/link";
import { PlayCircle } from "lucide-react";

export function Hero() {
  return (
    <section className="relative flex min-h-[560px] items-center justify-center overflow-hidden py-16 text-center text-white lg:h-[680px] lg:py-0">
      <Image
        src="/images/hero-bg.jpg"
        alt="Global Hydrology Visualization"
        fill
        className="object-cover"
        priority
      />
      <div className="absolute inset-0 bg-gradient-to-b from-hero/40 to-hero/80" />

      <div className="relative z-10 max-w-[900px] px-4 sm:px-6">
        <h1 className="mb-6 text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-5xl lg:text-[64px]">
          Democratizing Global Hydrologic Modeling
        </h1>
        <p className="mx-auto mb-8 max-w-[700px] text-lg sm:text-xl lg:mb-12 lg:text-[22px] leading-relaxed font-normal text-white/90">
          Make water sustainability research FAIR. Access high-performance
          computing and massive datasets directly via your browser.
        </p>
        <div className="flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center sm:gap-4">
          <Link href="/repository" className="inline-flex items-center justify-center min-h-12 rounded-xl bg-accent px-6 py-3 text-base font-semibold text-white shadow-[0_10px_20px_-5px] shadow-accent/40 sm:px-9 sm:py-4 transition-all hover:brightness-110">
            Explore Data Repository
          </Link>
          <button className="inline-flex items-center justify-center gap-2 min-h-12 rounded-xl border border-white/30 bg-white/10 px-6 py-3 sm:px-9 sm:py-4 text-base font-semibold text-white backdrop-blur-sm transition-all hover:bg-white/20">
            <PlayCircle className="h-5 w-5" />
            Start Simulation
          </button>
        </div>
      </div>
    </section>
  );
}
