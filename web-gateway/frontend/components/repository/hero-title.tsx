import { aboutName } from "@/lib/jobs/display-name";

/**
 * The title of a snapshot's or model input's page, on the hero banner. When the
 * artifact has a short name (`about.shortName`) that is the big title and the
 * full, citable `about.name` sits beneath it, smaller and quieter, so the page
 * still says what it is called in full. With no short name it is the one
 * `about.name` heading it has always been.
 */
export function HeroTitle({ about }: { about: { name: string; shortName?: string | null } }) {
  const title = aboutName(about);
  const full = title !== about.name ? about.name : null;
  return (
    <div className="mb-6 max-w-4xl">
      <h1 className="text-2xl leading-tight font-bold text-white md:text-3xl">{title}</h1>
      {full && (
        <p className="mt-2 text-sm leading-relaxed break-words text-white/75 md:text-[15px]">
          <span className="sr-only">Full title: </span>
          {full}
        </p>
      )}
    </div>
  );
}
