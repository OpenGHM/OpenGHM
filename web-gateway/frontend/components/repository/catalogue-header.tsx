/** The page's title block: a small eyebrow, the h1, and a line saying what the repository holds. */
export function CatalogueHeader() {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
      <div>
        <p className="mb-2 font-mono text-xs tracking-wider text-muted-foreground uppercase">Repository</p>
        <h1 className="text-[28px] leading-tight font-semibold tracking-tight text-foreground sm:text-[34px]">
          Data Repository
        </h1>
      </div>
      <p className="basis-full text-sm text-muted-foreground md:basis-auto">
        Model snapshots and inputs shared by the OpenGHM community
      </p>
    </header>
  );
}
