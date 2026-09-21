import { Metadata } from "next";
import { Header } from "@/components/landing/header";
import { Footer } from "@/components/landing/footer";
import { RepositoryTabs } from "@/components/repository/repository-tabs";
import { fetchDatasets, fetchModelInputs } from "@/lib/repository/actions";
import { TEMPORAL_RANGE_BOUNDS } from "@/lib/repository/data";
import { RepositoryListResponse, ModelInputListResponse } from "@/lib/repository/types";

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

const EMPTY_MODEL_INPUT_RESULT: ModelInputListResponse = {
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

  let initialModelInputs: ModelInputListResponse = EMPTY_MODEL_INPUT_RESULT;
  try {
    initialModelInputs = await fetchModelInputs({
      searchQuery: "",
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
        <RepositoryTabs
          initialDatasets={initialData}
          initialModelInputs={initialModelInputs}
        />
      </main>
      <Footer />
    </>
  );
}
