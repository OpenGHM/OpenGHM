"use server";

import { getApiClient } from "@/lib/api-client";
import { CATALOGUE_FACET_KEYS, CATALOGUE_PAGE_SIZE } from "@/lib/repository/catalogue";
import {
  CatalogueFilterState,
  CatalogueResponse,
  RepositoryListResponse,
  Dataset,
  FilterState,
  MineResponse,
  ModelInput,
  ModelInputFilterState,
  ModelInputListResponse,
  ModelInputLinks,
  SnapshotLinks,
} from "@/lib/repository/types";

/**
 * Fetch one page of the catalogue — snapshots and model inputs together, with
 * the facet options and counts for the sidebar — from FastAPI. Called from the
 * Data Repository page and, through `useUrlSyncedFilters`, from the browser
 * (BFF layer — the browser never calls FastAPI directly).
 *
 * A facet goes out as a repeated key (`tag=a&tag=b`): the client from
 * `getApiClient` serialises arrays that way (`paramsSerializer.indexes: null`).
 */
export async function fetchCatalogue(
  filters: CatalogueFilterState
): Promise<CatalogueResponse> {
  const client = await getApiClient();

  const params: Record<string, string | number | string[]> = {
    sort: filters.sortBy,
    page: filters.page,
    page_size: CATALOGUE_PAGE_SIZE,
  };

  if (filters.searchQuery.trim()) {
    params.q = filters.searchQuery.trim();
  }
  for (const key of CATALOGUE_FACET_KEYS) {
    if (filters[key].length > 0) params[key] = filters[key];
  }
  if (filters.yearStart !== null) params.year_start = filters.yearStart;
  if (filters.yearEnd !== null) params.year_end = filters.yearEnd;
  if (filters.spatialResMin !== null) params.spatial_res_min = filters.spatialResMin;
  if (filters.spatialResMax !== null) params.spatial_res_max = filters.spatialResMax;

  const response = await client.get<CatalogueResponse>("/api/v1/repository/catalogue", {
    params,
  });
  return response.data;
}

/**
 * Fetch what the signed-in user published — their snapshots and model inputs,
 * newest registration first — for the Workspace's Snapshots & Inputs section. Unlike
 * the other reads here it needs a session: a 401 is thrown as the Axios error
 * it is, for the page to turn into a sign-in redirect.
 */
export async function fetchMine(): Promise<MineResponse> {
  const client = await getApiClient();
  const response = await client.get<MineResponse>("/api/v1/repository/mine");
  return response.data;
}

/**
 * Fetch a paginated, filtered list of datasets from FastAPI. The snapshot
 * picker in the new-simulation wizard uses it (BFF layer — the browser never
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

/**
 * Download links for a published snapshot (`GET .../datasets/{id}/links`).
 * Used by the detail page `/repository/[id]`.
 */
export async function fetchDatasetLinks(id: string): Promise<SnapshotLinks | null> {
  try {
    const client = await getApiClient();
    const response = await client.get<SnapshotLinks>(
      `/api/v1/repository/datasets/${encodeURIComponent(id)}/links`
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = error as { response?: { status?: number } };
    if (axiosError?.response?.status === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Download links for a published model input
 * (`GET .../model-inputs/{id}/links`). Used by `/repository/model-inputs/[id]`.
 */
export async function fetchModelInputLinks(id: string): Promise<ModelInputLinks | null> {
  try {
    const client = await getApiClient();
    const response = await client.get<ModelInputLinks>(
      `/api/v1/repository/model-inputs/${encodeURIComponent(id)}/links`
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = error as { response?: { status?: number } };
    if (axiosError?.response?.status === 404) {
      return null;
    }
    throw error;
  }
}
