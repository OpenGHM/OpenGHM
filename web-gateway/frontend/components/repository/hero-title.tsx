/**
 * The size of a detail page's title for a name of this length. A short name
 * keeps the size the page always had; a long one (a paper title) steps down so
 * it takes two or three lines rather than four or five. Each class is written
 * whole, because Tailwind reads the source text.
 */
export function heroTitleSize(name: string): string {
  const length = name.trim().length;
  if (length >= 140) return "text-lg md:text-xl";
  if (length >= 90) return "text-xl md:text-2xl";
  return "text-2xl md:text-3xl";
}

/**
 * The title of a snapshot's or model input's page, on the hero banner: the
 * whole name, never clamped (it is what the page is called), balanced over its
 * lines, and stepped down in size with its length (`heroTitleSize`). A long
 * name is also held to a readable measure.
 */
export function HeroTitle({ name }: { name: string }) {
  const long = name.trim().length >= 90;
  return (
    <h1
      className={`mb-6 leading-tight font-bold text-balance break-words text-white ${heroTitleSize(name)}${long ? " max-w-4xl" : ""}`}
    >
      {name}
    </h1>
  );
}
