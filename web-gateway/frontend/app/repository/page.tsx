import { Metadata } from "next";
import { Header } from "@/components/landing/header";
import { Footer } from "@/components/landing/footer";
import { RepositoryClient } from "@/components/repository/repository-client";
import { fetchDatasets } from "@/lib/repository/actions";
import { TEMPORAL_RANGE_BOUNDS } from "@/lib/repository/data";
import { RepositoryListResponse } from "@/lib/repository/types";

export const metadata: Metadata = {
  title: "Data Repository | OpenGHM",
  description:
    "Browse and discover global hydrologic datasets, model outputs, and climate forcing data.",
};

const EMPTY_RESULT: RepositoryListResponse = {
  items: [],
  totalCount: 0,
  totalPages: 1,
  page: 1,
};

export default async function RepositoryPage() {
  // Server-side pre-fetch for initial render (SSR)
  let initialData: RepositoryListResponse = EMPTY_RESULT;
  try {
    initialData = await fetchDatasets({
      searchQuery: "",
      temporalCoverageStart: TEMPORAL_RANGE_BOUNDS.min,
      temporalCoverageEnd: TEMPORAL_RANGE_BOUNDS.max,
      spatialResMin: null,
      spatialResMax: null,
      sortBy: "relevance",
      page: 1,
    });
  } catch {
    // Backend unavailable — client will retry via useEffect
  }

  return (
    <>
      <Header />
      <main className="min-h-screen bg-muted/30">
        <RepositoryClient initialData={initialData} />
      </main>
      <Footer />
    </>
  );
}
