"use server";

import { getApiClient } from "@/lib/api-client";
import { describeFailure } from "@/lib/action-failure";
import type { ActionResult } from "@/lib/jobs/types";
import type { ModelParameters } from "@/lib/workspace/model-parameters";
import {
  CATALOGUE_FACET_KEYS,
  CATALOGUE_PAGE_SIZE,
  SNAPSHOT_PICKER_FIXED_FILTERS,
  SNAPSHOT_PICKER_PAGE_SIZE,
} from "@/lib/repository/catalogue";
import { regionFromNumbers } from "@/lib/repository/region";
import {
  CatalogueFilterState,
  CatalogueResponse,
  Dataset,
  MineResponse,
  ModelInput,
  ModelInputFilterState,
  ModelInputListResponse,
  ModelInputLinks,
  SnapshotLinks,
  TreeKind,
  TreeListing,
  TreePreview,
  TreeResult,
} from "@/lib/repository/types";
import { treeFailureCode, treeRoute } from "@/lib/repository/tree-browse";

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
  filters: CatalogueFilterState,
  pageSize: number = CATALOGUE_PAGE_SIZE
): Promise<CatalogueResponse> {
  const client = await getApiClient({ allowAnonymous: true });

  const params: Record<string, string | number | string[]> = {
    sort: filters.sortBy,
    page: filters.page,
    page_size: pageSize,
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

  const box = regionFromNumbers(filters.boxNorth, filters.boxSouth, filters.boxEast, filters.boxWest);
  if (box) {
    params.north = box.north;
    params.south = box.south;
    params.east = box.east;
    params.west = box.west;
  }

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
  const client = await getApiClient({ allowAnonymous: true });
  const response = await client.get<MineResponse>("/api/v1/repository/mine");
  return response.data;
}

/**
 * One page of the model snapshots, searched and filtered the way the Data
 * Repository does it: the same `GET /repository/catalogue` with the Type facet
 * fixed to `snapshot` (`SNAPSHOT_PICKER_FIXED_FILTERS`), so the search, every
 * other filter, the facet counts and the order are the repository's own. The
 * Start screen's snapshot picker (`/workspace/new`) is its one reader. Whatever
 * the filters hold for what is fixed is replaced.
 */
export async function fetchSnapshots(
  filters: CatalogueFilterState
): Promise<CatalogueResponse> {
  return fetchCatalogue({ ...filters, ...SNAPSHOT_PICKER_FIXED_FILTERS }, SNAPSHOT_PICKER_PAGE_SIZE);
}

/**
 * Fetch a single dataset by ID.
 * Used by the detail page `/repository/[id]`.
 */
export async function fetchDatasetById(id: string): Promise<Dataset | null> {
  try {
    const client = await getApiClient({ allowAnonymous: true });
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
 * The parameter tree for a snapshot's WBM version, with the current value of
 * every field from the snapshot's init
 * (`GET .../datasets/{id}/model-parameters`). The draft wizard's Model
 * parameters section renders it. Anyone who may read the snapshot may ask.
 * Failures come back as data: `not_found` is a dataset that is not a snapshot,
 * a 503 `init_unavailable` an init that could not be read. A 20 s timeout: the
 * first read of an init goes to the public bucket.
 */
export async function fetchModelParameters(id: string): Promise<ActionResult<ModelParameters>> {
  try {
    const client = await getApiClient({ allowAnonymous: true, timeoutMs: 20_000 });
    const response = await client.get<ModelParameters>(
      `/api/v1/repository/datasets/${encodeURIComponent(id)}/model-parameters`
    );
    return { ok: true, data: response.data };
  } catch (error: unknown) {
    return describeFailure(error, [404]);
  }
}

/**
 * Fetch a paginated, filtered list of model inputs from FastAPI (ADR 0015).
 * The same envelope as the catalogue's, but no spatial/temporal filters:
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
  const client = await getApiClient({ allowAnonymous: true });

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
 * (the same distinction the draft wizard's summary draws for a
 * snapshot draft's effective model input, by looking it up by id). `page_size: 100` is a one-shot upper bound, not a
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
    const client = await getApiClient({ allowAnonymous: true });
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
    const client = await getApiClient({ allowAnonymous: true });
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
    const client = await getApiClient({ allowAnonymous: true });
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

/**
 * One folder of a published tree (`GET .../{id}/files`), one S3 page of it:
 * `cursor` is the previous page's `nextCursor`. The backend's coded refusals
 * come back as data (`TreeResult`) for the files page to show a state for each;
 * only a failure of this call itself would throw. Used by `TreeBrowser`.
 */
export async function fetchTreeListing(
  kind: TreeKind,
  id: string,
  path: string,
  cursor?: string | null
): Promise<TreeResult<TreeListing>> {
  try {
    const client = await getApiClient({ allowAnonymous: true });
    const params: Record<string, string> = { path };
    if (cursor) params.cursor = cursor;
    const response = await client.get<TreeListing>(`${treeRoute(kind, id)}/files`, { params });
    return { ok: true, data: response.data };
  } catch (error: unknown) {
    return { ok: false, code: treeFailureCode(error, "listing_unavailable") };
  }
}

/**
 * The first 256 KiB of one file of a published tree
 * (`GET .../{id}/files/preview`). Answers as `fetchTreeListing` does.
 */
export async function fetchTreePreview(
  kind: TreeKind,
  id: string,
  path: string
): Promise<TreeResult<TreePreview>> {
  try {
    const client = await getApiClient({ allowAnonymous: true });
    const response = await client.get<TreePreview>(`${treeRoute(kind, id)}/files/preview`, {
      params: { path },
    });
    return { ok: true, data: response.data };
  } catch (error: unknown) {
    return { ok: false, code: treeFailureCode(error, "preview_unavailable") };
  }
}
