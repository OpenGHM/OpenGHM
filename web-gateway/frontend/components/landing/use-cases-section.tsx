import Image from "next/image";

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
    <section className="bg-[#f0f4f8] py-16 lg:py-30">
      <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-10">
        <div className="text-center">
          <span className="mb-4 block text-sm font-bold uppercase tracking-widest text-primary">
            Who is it for?
          </span>
          <h2 className="text-3xl font-extrabold leading-tight sm:text-4xl lg:text-[42px] tracking-tight text-[#0f172a]">
            Empowering the Research Community
          </h2>
        </div>

        <div className="mx-auto mt-10 grid max-w-md grid-cols-1 gap-10 md:max-w-none md:grid-cols-3 md:gap-8 lg:mt-16 lg:gap-12">
          {USE_CASES.map((useCase) => (
            <div
              key={useCase.title}
              className="flex min-w-0 flex-col items-center gap-4 text-center lg:gap-6"
            >
              <Image
                src={useCase.image}
                alt={useCase.title}
                width={400}
                height={300}
                className="aspect-[4/3] w-full rounded-lg bg-slate-200 object-cover shadow-[0_4px_6px_-1px_rgba(0,0,0,0.05)]"
              />
              <h3 className="text-xl font-bold text-[#0f172a] lg:text-2xl">
                {useCase.title}
              </h3>
              <p className="text-base leading-relaxed text-slate-600">
                {useCase.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
