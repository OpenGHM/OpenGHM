import { PageHero } from "@/components/layout/page-hero";
import { CatalogueSearch } from "./catalogue-search";

/**
 * The page's navy band: the site header, a small eyebrow, the h1, a line saying
 * what the repository holds, and the search box. The box reads the query from
 * the `CatalogueSearchProvider` that `CatalogueClient` puts around the band.
 */
export function CatalogueHeader() {
  return (
    <PageHero
      eyebrow="Data Repository"
      title="Find model snapshots and inputs for hydrologic research."
    >
      <CatalogueSearch />
    </PageHero>
  );
}
