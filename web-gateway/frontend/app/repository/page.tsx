import { Metadata } from "next";
import { Header } from "@/components/landing/header";
import { Footer } from "@/components/landing/footer";
import { RepositoryTabs } from "@/components/repository/repository-tabs";
import { fetchDatasets, fetchModelInputs } from "@/lib/repository/actions";
import { parseDatasetFilters, parseModelInputFilters, toURLSearchParams } from "@/lib/repository/url-filters";
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

export default async function RepositoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const rawParams = await searchParams;
  const params = toURLSearchParams(rawParams);
  const initialTab = params.get("tab") === "model-inputs" ? "model-inputs" : "snapshots";
  const datasetFilters = parseDatasetFilters(params);
  const modelInputFilters = parseModelInputFilters(params);

  // Server-side pre-fetch for initial render (SSR), hydrated from the URL
  // rather than fixed defaults — see open item 16 / url-filters.ts.
  let initialData: RepositoryListResponse = EMPTY_RESULT;
  try {
    initialData = await fetchDatasets(datasetFilters);
  } catch {
    // Backend unavailable — client will retry via useEffect
  }

  let initialModelInputs: ModelInputListResponse = EMPTY_MODEL_INPUT_RESULT;
  try {
    initialModelInputs = await fetchModelInputs(modelInputFilters);
  } catch {
    // Backend unavailable — client will retry via useEffect
  }

  return (
    <>
      <Header />
      <main className="min-h-screen bg-muted/30">
        <RepositoryTabs
          initialTab={initialTab}
          initialDatasetFilters={datasetFilters}
          initialModelInputFilters={modelInputFilters}
          initialDatasets={initialData}
          initialModelInputs={initialModelInputs}
        />
      </main>
      <Footer />
    </>
  );
}
