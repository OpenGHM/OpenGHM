import Image from "next/image";
import { SectionEyebrow, SectionTitle } from "./section-parts";

interface UseCase {
  image: string;
  title: string;
  description: string;
}

const USE_CASES: UseCase[] = [
  {
    image: "/images/usecase-researchers.jpg",
    title: "Interdisciplinary Researchers",
    description:
      "Bridging hydrology with economics and policy making to solve complex global water challenges.",
  },
  {
    image: "/images/usecase-scientists.jpg",
    title: "Power Users & Scientists",
    description:
      "Executing large-scale ensemble simulations with massive compute resources on NSF Anvil.",
  },
  {
    image: "/images/usecase-educators.jpg",
    title: "Educators & Students",
    description:
      "Lowering the barrier to entry for learning global hydrology through interactive, browser-based tools.",
  },
];

export function UseCasesSection() {
  return (
    <section className="flex flex-col gap-9">
      <div className="flex flex-col gap-3.5">
        <SectionEyebrow>Who is it for?</SectionEyebrow>
        <SectionTitle>Empowering the Research Community</SectionTitle>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-3.5">
        {USE_CASES.map((useCase) => (
          <article
            key={useCase.title}
            className="relative flex min-h-[400px] min-w-0 flex-col justify-end overflow-hidden rounded-[24px] bg-hero text-white"
          >
            <Image
              src={useCase.image}
              alt={useCase.title}
              fill
              sizes="(min-width: 1360px) 440px, (min-width: 768px) 33vw, 100vw"
              className="object-cover"
            />
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-gradient-to-b from-hero/0 from-30% to-hero/92"
            />
            <div className="relative flex flex-col gap-2.5 p-7">
              <h3 className="text-[22px] font-[650] tracking-[-0.02em]">
                {useCase.title}
              </h3>
              <p className="text-[14.5px] leading-[1.6] text-pretty text-hero-text">
                {useCase.description}
              </p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
