import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// A filter change writes the URL with the native pushState, which Next's router follows;
// it must not go through `router.push`, which would render the server page again.
const push = vi.fn();
const pushState = vi.spyOn(window.history, "pushState").mockImplementation(() => {});
// One object for the whole test, as Next gives: a new one per render would read as a navigation.
let search = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => "/repository",
  useSearchParams: () => search,
}));
vi.mock("@/lib/repository/actions", () => ({ fetchCatalogue: vi.fn() }));

import { fetchCatalogue } from "@/lib/repository/actions";
import { CatalogueClient } from "./catalogue-client";
import { catalogueFiltersToParams } from "@/lib/repository/url-filters";
import { filters, modelInputItem, response, snapshotItem } from "./catalogue.fixtures";

beforeAll(() => {
  // The sidebar's slider reads the layout; jsdom has none.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  cleanup();
  push.mockClear();
  pushState.mockClear();
  vi.mocked(fetchCatalogue).mockReset();
});

function setup(initial = filters()) {
  search = catalogueFiltersToParams(initial);
  const data = response([snapshotItem(), modelInputItem()]);
  vi.mocked(fetchCatalogue).mockResolvedValue(data);
  return render(<CatalogueClient initialFilters={initial} initialData={data} />);
}

describe("CatalogueClient tag chips", () => {
  it("add the tag to the URL as a repeated `tag` key, keep the other filters and go back to page 1", async () => {
    setup(filters({ tag: ["publication"], keyword: ["storage"], page: 3 }));
    fireEvent.click(screen.getByRole("button", { name: "Filter by tag River network" }));
    await waitFor(() => expect(pushState).toHaveBeenCalled());
    expect(push).not.toHaveBeenCalled();
    const query = new URLSearchParams(String(pushState.mock.calls.at(-1)?.[2]).split("?")[1]);
    expect(query.getAll("tag")).toEqual(["publication", "river-network"]);
    expect(query.getAll("keyword")).toEqual(["storage"]);
    expect(query.has("page")).toBe(false);
  });

  it("take an already selected tag off, and ask the backend with the remaining `tag` values", async () => {
    setup(filters({ tag: ["publication", "climate-forcing"] }));
    fireEvent.click(screen.getByRole("button", { name: "Filter by tag Publication" }));
    await waitFor(() => expect(fetchCatalogue).toHaveBeenCalled());
    expect(vi.mocked(fetchCatalogue).mock.calls.at(-1)?.[0].tag).toEqual(["climate-forcing"]);
    const query = new URLSearchParams(String(pushState.mock.calls.at(-1)?.[2]).split("?")[1]);
    expect(query.getAll("tag")).toEqual(["climate-forcing"]);
  });
});
