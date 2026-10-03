import { beforeEach, describe, expect, it, vi } from "vitest";

const { get, getApiClient } = vi.hoisted(() => {
  const get = vi.fn();
  return { get, getApiClient: vi.fn(async () => ({ get })) };
});
vi.mock("@/lib/api-client", () => ({ getApiClient }));

import { fetchCatalogue, fetchMine, fetchSnapshots } from "./actions";
import { EMPTY_CATALOGUE_FILTERS } from "./catalogue";

beforeEach(() => {
  get.mockReset();
  getApiClient.mockClear();
});

describe("fetchMine", () => {
  it("asks for the caller's own published items, with the session's client, and returns the body", async () => {
    const body = { items: [{ id: "snap-1", kind: "snapshot" }] };
    get.mockResolvedValue({ data: body });

    await expect(fetchMine()).resolves.toBe(body);

    expect(getApiClient).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith("/api/v1/repository/mine");
  });

  it("lets a failure through, a 401 included, for the page to decide on", async () => {
    const unauthorized = { response: { status: 401 } };
    get.mockRejectedValue(unauthorized);

    await expect(fetchMine()).rejects.toBe(unauthorized);
  });
});

describe("fetchSnapshots", () => {
  it("is the catalogue's own query with the type fixed to snapshot, a page of twelve, and the filters unchanged", async () => {
    const body = { items: [], totalCount: 0, totalPages: 1, page: 1, facets: {} };
    get.mockResolvedValue({ data: body });

    const filters = {
      ...EMPTY_CATALOGUE_FILTERS,
      searchQuery: " wbm ",
      tag: ["tutorial", "publication"],
      yearStart: 2000,
      spatialResMax: 0.25,
      page: 2,
    };
    await expect(fetchSnapshots(filters)).resolves.toBe(body);

    expect(get).toHaveBeenCalledWith("/api/v1/repository/catalogue", {
      params: {
        sort: "relevance",
        page: 2,
        page_size: 12,
        q: "wbm",
        type: ["snapshot"],
        tag: ["tutorial", "publication"],
        year_start: 2000,
        spatial_res_max: 0.25,
      },
    });
  });

  it("replaces a type the filters hold, so the picker never lists a model input", async () => {
    get.mockResolvedValue({ data: {} });
    await fetchSnapshots({ ...EMPTY_CATALOGUE_FILTERS, type: ["model-input"] });
    expect(get.mock.calls[0][1].params.type).toEqual(["snapshot"]);
  });

  it("leaves the repository's own page size alone", async () => {
    get.mockResolvedValue({ data: {} });
    await fetchCatalogue(EMPTY_CATALOGUE_FILTERS);
    expect(get.mock.calls[0][1].params.page_size).toBe(10);
  });
});
