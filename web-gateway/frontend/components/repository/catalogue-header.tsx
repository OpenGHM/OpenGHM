import { PageHero } from "@/components/layout/page-hero";

/** The page's navy band: the site header, a small eyebrow, the h1, and a line saying what the repository holds. */
export function CatalogueHeader() {
  return (
    <PageHero
      eyebrow="Repository"
      title="Data Repository"
      subtitle="Model snapshots and inputs shared by the OpenGHM community"
    />
  );
}
