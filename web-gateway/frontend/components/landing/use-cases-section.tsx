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
    <section className="bg-[#f0f4f8] py-30">
      <div className="mx-auto max-w-[1280px] px-10">
        <div className="text-center">
          <span className="mb-4 block text-sm font-bold uppercase tracking-widest text-primary">
            Who is it for?
          </span>
          <h2 className="text-[42px] font-extrabold leading-tight tracking-tight text-[#0f172a]">
            Empowering the Research Community
          </h2>
        </div>

        <div className="mt-16 grid grid-cols-3 gap-12">
          {USE_CASES.map((useCase) => (
            <div
              key={useCase.title}
              className="flex flex-col items-center gap-6 text-center"
            >
              <Image
                src={useCase.image}
                alt={useCase.title}
                width={400}
                height={300}
                className="aspect-[4/3] w-full rounded-lg bg-slate-200 object-cover shadow-[0_4px_6px_-1px_rgba(0,0,0,0.05)]"
              />
              <h3 className="text-2xl font-bold text-[#0f172a]">
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
