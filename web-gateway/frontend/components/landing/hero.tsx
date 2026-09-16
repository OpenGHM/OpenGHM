import Image from "next/image";
import Link from "next/link";
import { PlayCircle } from "lucide-react";

export function Hero() {
  return (
    <section className="relative flex h-[680px] items-center justify-center overflow-hidden text-center text-white">
      <Image
        src="/images/hero-bg.jpg"
        alt="Global Hydrology Visualization"
        fill
        className="object-cover"
        priority
      />
      <div className="absolute inset-0 bg-gradient-to-b from-[rgba(10,25,47,0.4)] to-[rgba(10,25,47,0.8)]" />

      <div className="relative z-10 max-w-[900px] px-6">
        <h1 className="mb-6 text-[64px] font-extrabold leading-[1.1] tracking-tight">
          Democratizing Global Hydrologic Modeling
        </h1>
        <p className="mx-auto mb-12 max-w-[700px] text-[22px] leading-relaxed font-normal text-white/90">
          Make water sustainability research FAIR. Access high-performance
          computing and massive datasets directly via your browser.
        </p>
        <div className="flex justify-center gap-4">
          <Link href="/repository" className="inline-flex items-center justify-center rounded-xl bg-accent px-9 py-4 text-base font-semibold text-white shadow-[0_10px_20px_-5px_rgba(0,180,216,0.4)] transition-all hover:brightness-110">
            Explore Data Repository
          </Link>
          <button className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/30 bg-white/10 px-9 py-4 text-base font-semibold text-white backdrop-blur-sm transition-all hover:bg-white/20">
            <PlayCircle className="h-5 w-5" />
            Start Simulation
          </button>
        </div>
      </div>
    </section>
  );
}
