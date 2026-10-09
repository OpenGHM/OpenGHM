import { Metadata } from "next";
import { Footer } from "@/components/landing/footer";
import { CatalogueHeader } from "@/components/repository/catalogue-header";
import { CatalogueClient } from "@/components/repository/catalogue-client";
import { EMPTY_CATALOGUE } from "@/lib/repository/catalogue";
import { fetchCatalogue } from "@/lib/repository/actions";
import { parseCatalogueFilters, toURLSearchParams } from "@/lib/repository/url-filters";
import type { CatalogueResponse } from "@/lib/repository/types";

export const metadata: Metadata = {
  title: "Data Repository | OpenGHM",
  description:
    "Browse and discover published model snapshots and model inputs for global hydrologic modelling.",
};

export default async function RepositoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const rawParams = await searchParams;
  const filters = parseCatalogueFilters(toURLSearchParams(rawParams));

  // Server-side pre-fetch for the first render, taken from the URL so a shared
  // link shows the same list (open item 16 / url-filters.ts).
  let initialData: CatalogueResponse = EMPTY_CATALOGUE;
  let initialError = false;
  try {
    initialData = await fetchCatalogue(filters);
  } catch {
    // Backend unavailable: the list opens with its error box and a Retry button.
    initialError = true;
  }

  return (
    <>
      <CatalogueClient
        hero={<CatalogueHeader />}
        initialFilters={filters}
        initialData={initialData}
        initialError={initialError}
      />
      <Footer />
    </>
  );
}
