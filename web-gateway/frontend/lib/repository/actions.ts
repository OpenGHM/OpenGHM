"use server";

import { getApiClient } from "@/lib/api-client";
import {
  RepositoryListResponse,
  Dataset,
  FilterState,
  ModelInput,
  ModelInputFilterState,
  ModelInputListResponse,
} from "@/lib/repository/types";

/**
 * Fetch a paginated, filtered list of datasets from FastAPI.
 * Called via useTransition in repository-client.tsx (BFF layer — browser never
 * calls FastAPI directly).
 */
export async function fetchDatasets(
  filters: FilterState
): Promise<RepositoryListResponse> {
  const client = await getApiClient();

  const params: Record<string, string | number> = {
    sort: filters.sortBy,
    page: filters.page,
    page_size: 5,
  };

  if (filters.searchQuery.trim()) {
    params.q = filters.searchQuery.trim();
  }
  if (filters.temporalCoverageStart != null) {
    params.year_start = filters.temporalCoverageStart;
  }
  if (filters.temporalCoverageEnd != null) {
    params.year_end = filters.temporalCoverageEnd;
  }
  if (filters.spatialResMin !== null) {
    params.spatial_res_min = filters.spatialResMin;
  }
  if (filters.spatialResMax !== null) {
    params.spatial_res_max = filters.spatialResMax;
  }
  const response = await client.get<RepositoryListResponse>(
    "/api/v1/repository/datasets",
    { params }
  );

  return response.data;
}

/**
 * Fetch a single dataset by ID.
 * Used by the detail page `/repository/[id]`.
 */
export async function fetchDatasetById(id: string): Promise<Dataset | null> {
  try {
    const client = await getApiClient();
    const response = await client.get<Dataset>(
      `/api/v1/repository/datasets/${encodeURIComponent(id)}`
    );
    return response.data;
  } catch (error: unknown) {
    // 404 → return null so the page can call notFound()
    const axiosError = error as { response?: { status?: number } };
    if (axiosError?.response?.status === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Fetch a paginated, filtered list of model inputs from FastAPI (ADR 0015).
 * Sibling of `fetchDatasets` — same envelope, no spatial/temporal filters:
 * a model input has no single top-level resolution to filter on the way a
 * snapshot's `simulation.resolution` does (see `ModelInputResponse`'s
 * docstring in `app/models/repository.py`).
 *
 * `pageSize` defaults to the list's own page size (5); `fetchModelInputIds`
 * below is the one caller that raises it, for a one-shot existence check
 * rather than a browsable page.
 */
export async function fetchModelInputs(
  filters: ModelInputFilterState,
  pageSize: number = 5
): Promise<ModelInputListResponse> {
  const client = await getApiClient();

  const params: Record<string, string | number> = {
    sort: filters.sortBy,
    page: filters.page,
    page_size: pageSize,
  };

  if (filters.searchQuery.trim()) {
    params.q = filters.searchQuery.trim();
  }

  const response = await client.get<ModelInputListResponse>(
    "/api/v1/repository/model-inputs",
    { params }
  );

  return response.data;
}

/**
 * Every published model input's id, for the dataset table's "model input
 * status" badge — a snapshot's `uses.modelInput.id` always names one, but
 * only checking membership here tells "present" from "inherited-missing"
 * (the same distinction `wizard-review-step.tsx` draws for a simulation's
 * effective model input). `page_size: 100` is a one-shot upper bound, not a
 * pagination contract — the catalogue is small; this fetches it whole.
 */
export async function fetchModelInputIds(): Promise<Set<string>> {
  const { items } = await fetchModelInputs(
    { searchQuery: "", sortBy: "relevance", page: 1 },
    100
  );
  return new Set(items.map((m) => m.id));
}

/**
 * Fetch a single model input by ID.
 * Used by the detail page `/repository/model-inputs/[id]`.
 */
export async function fetchModelInputById(
  id: string
): Promise<ModelInput | null> {
  try {
    const client = await getApiClient();
    const response = await client.get<ModelInput>(
      `/api/v1/repository/model-inputs/${encodeURIComponent(id)}`
    );
    return response.data;
  } catch (error: unknown) {
    // 404 → return null so the page can call notFound()
    const axiosError = error as { response?: { status?: number } };
    if (axiosError?.response?.status === 404) {
      return null;
    }
    throw error;
  }
}
