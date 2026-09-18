"use server";

import { getApiClient } from "@/lib/api-client";
import {
  RepositoryListResponse,
  Dataset,
  FilterState,
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
