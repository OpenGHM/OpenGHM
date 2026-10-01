import Image from "next/image";
import { ArrowRight } from "lucide-react";

export function ChallengeSection() {
  return (
    <section className="bg-white py-16 lg:py-30">
      <div className="mx-auto grid max-w-[1280px] grid-cols-1 items-center gap-10 px-4 sm:px-6 lg:px-10 lg:grid-cols-2 lg:gap-24">
        <div>
          <span className="mb-4 block text-sm font-bold uppercase tracking-widest text-primary">
            The Challenge
          </span>
          <h2 className="mb-6 text-3xl font-extrabold leading-tight sm:text-4xl lg:text-[42px] tracking-tight text-[#0f172a]">
            Bridging the Gap in
            <br />
            Water Science
          </h2>
          <p className="mb-6 text-lg leading-relaxed text-slate-600">
            OpenGHM removes technical barriers to storing, accessing, and
            running the data and code that enables large-scale hydrologic
            modeling. We provide a unified, cloud-native platform that
            integrates data, compute, and visualization.
          </p>
          <a className="mt-4 inline-flex min-h-10 cursor-pointer items-center gap-2 font-bold text-primary">
            Read our Mission Statement
            <ArrowRight className="h-4 w-4" />
          </a>
        </div>

        <div className="overflow-hidden rounded-3xl shadow-[0_25px_50px_-12px_rgba(0,0,0,0.15)]">
          <Image
            src="/images/challenge.jpg"
            alt="Simplifying Complexity"
            width={600}
            height={450}
            className="h-auto w-full object-cover"
          />
        </div>
      </div>
    </section>
  );
}
