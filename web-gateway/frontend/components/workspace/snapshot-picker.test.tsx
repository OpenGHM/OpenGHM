import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const { fetchDatasets, fetchModelInputIds } = vi.hoisted(() => ({
  fetchDatasets: vi.fn(),
  fetchModelInputIds: vi.fn(),
}));
// The address bar is the router: what the hook pushes is what `useSearchParams` reads.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("@/lib/repository/actions", () => ({ fetchDatasets, fetchModelInputIds }));
// The map is Leaflet, which jsdom cannot draw.
vi.mock("@/components/repository/bounding-box-map-dynamic", () => ({
  BoundingBoxMap: () => <div data-testid="map" />,
}));

import { SnapshotPicker } from "@/components/workspace/snapshot-picker";
import { fakeDataset } from "@/lib/workspace/fixtures";
import type { Dataset, FilterState, RepositoryListResponse } from "@/lib/repository/types";

// The filter sliders read ResizeObserver, which jsdom does not have.
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
beforeEach(() => {
  fetchDatasets.mockReset();
  fetchModelInputIds.mockReset();
  fetchModelInputIds.mockResolvedValue(new Set());
  window.history.replaceState(null, "", "/workspace/new");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const FILTERS: FilterState = {
  searchQuery: "",
  temporalCoverageStart: null,
  temporalCoverageEnd: null,
  spatialResMin: null,
  spatialResMax: null,
  sortBy: "relevance",
  page: 1,
};

const LONG_TITLE =
  "WBM v1.0.0 Global_tracking simulation for 'Water balance model (WBM) v.1.0.0: a scalable gridded global hydrologic model with water-tracking functionality': [Global] [2000-2009]";

/** A snapshot of model `version`, covering `start`–`end` (years). */
const named = (id: string, name: string, version: string, years: [string, string], tags: Dataset["about"]["tags"] = ["test"]) => {
  const base = fakeDataset();
  return fakeDataset({
    id,
    about: { ...base.about, name, tags },
    uses: { ...base.uses, container: { ...base.uses.container, version } },
    simulation: {
      ...base.simulation,
      temporalCoverage: { start: `${years[0]}-01-01`, end: `${years[1]}-12-31` },
      resolution: { value: 5, unit: "arc-minute" },
    },
  });
};
const GLOBAL = named("global", LONG_TITLE, "1.0.0", ["2000", "2009"]);
const TUTORIAL = named("tutorial", "WBM v2.0.0 simulation as tutorial", "2.0.0", ["2000", "2001"], ["tutorial"]);
/** A catalogue past `CONTROLS_THRESHOLD`: the first two are the ones above. */
const BIG = [
  GLOBAL,
  TUTORIAL,
  ...Array.from({ length: 8 }, (_, i) => named(`more-${i}`, `Snapshot ${i}`, `3.${i}.0`, ["2001", "2001"])),
];

const page = (items: Dataset[], totalPages = 1): RepositoryListResponse => ({
  items,
  totalCount: items.length,
  totalPages,
  page: 1,
});

function renderPicker(
  over: Partial<React.ComponentProps<typeof SnapshotPicker>> = {},
  data: RepositoryListResponse = page(BIG)
) {
  const onSelect = vi.fn();
  const view = render(
    <SnapshotPicker
      initialFilters={FILTERS}
      initialData={data}
      initialModelInputIds={new Set()}
      usedIds={new Set()}
      onSelect={onSelect}
      {...over}
    />
  );
  return { ...view, onSelect };
}

/** Past the 300 ms the filters debounce, and any fetch it starts. */
const settle = (ms = 300) => act(() => vi.advanceTimersByTimeAsync(ms));

const filtersToggle = () => screen.getByRole("button", { name: /^Filters/ });

const snapshotCard = (name: string) =>
  within(screen.getByRole("list", { name: "Model snapshots" }))
    .getByRole("button", { name })
    .closest("li") as HTMLElement;

describe("the list", () => {
  it("is a grid of cards, not a table, with no sidebar", () => {
    renderPicker();
    expect(screen.queryByRole("table")).toBeNull();
    const items = within(screen.getByRole("list", { name: "Model snapshots" })).getAllByRole("listitem");
    expect(items).toHaveLength(10);
    expect(items[0].textContent).toContain("WBM 1.0.0 · 2000–2009");
    expect(items[0].textContent).toContain(LONG_TITLE);
    expect(items[0].textContent).toContain("5 arc-min");
    expect(items[1].textContent).toContain("Tutorial");
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("selects from a card's name, and Details does not select", () => {
    const { onSelect } = renderPicker();
    fireEvent.click(within(snapshotCard("WBM 2.0.0 · 2000–2001")).getByRole("button", { name: "WBM 2.0.0 · 2000–2001" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(TUTORIAL);
    fireEvent.click(screen.getByRole("button", { name: `Details: ${LONG_TITLE}` }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("marks the snapshots in usedIds and lists them first", () => {
    renderPicker({ usedIds: new Set(["more-3"]) });
    const items = within(screen.getByRole("list", { name: "Model snapshots" })).getAllByRole("listitem");
    expect(items[0].textContent).toContain("Used before");
    expect(items[0].textContent).toContain("WBM 3.3.0 · 2001");
    expect(screen.getAllByText("Used before")).toHaveLength(1);
  });

  it("turns the cards off and covers the clicked one while a draft is being made", () => {
    renderPicker({ pendingId: "global", disabled: true });
    expect(screen.getByRole("status").textContent).toContain("Creating your draft");
    expect((screen.getAllByRole("button", { name: /^WBM / })[0] as HTMLButtonElement).disabled).toBe(true);
  });

  it("colours the chips with tokens, not raw palette classes", () => {
    const { container } = renderPicker();
    expect(container.innerHTML).not.toMatch(/#006994|emerald|amber/);
  });
});

describe("search and Filters", () => {
  const controls = () => ({
    search: screen.queryByRole("searchbox", { name: "Search model snapshots" }),
    filters: screen.queryByRole("button", { name: /^Filters/ }),
    count: screen.queryByText(/model snapshots?$/),
  });

  it("are not shown for a short catalogue: three snapshots are looked at, not searched", () => {
    renderPicker({}, page([GLOBAL, TUTORIAL, named("third", "Third", "1.0.0", ["2000", "2009"])]));
    expect(controls()).toEqual({ search: null, filters: null, count: null });
    expect(within(screen.getByRole("list", { name: "Model snapshots" })).getAllByRole("listitem")).toHaveLength(3);
  });

  it("appear when there are more than nine, and not at nine", () => {
    const { unmount } = renderPicker({}, page(BIG.slice(0, 9)));
    expect(controls().search).toBeNull();
    unmount();
    renderPicker({}, page(BIG));
    expect(controls().search).not.toBeNull();
    expect(controls().filters).not.toBeNull();
  });

  it("stay when a search or filter is already narrowing a short list, so it can be undone", () => {
    renderPicker({ initialFilters: { ...FILTERS, searchQuery: "tutorial" } }, page([TUTORIAL]));
    expect(controls().search).not.toBeNull();
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("tutorial");
    expect(screen.getByRole("button", { name: "Reset" })).toBeTruthy();
  });

  it("appear when there is a second page", () => {
    renderPicker({}, page([GLOBAL, TUTORIAL], 2));
    expect(controls().search).not.toBeNull();
  });
});

describe("the toolbar and the Filters panel", () => {
  it("has a search box, and a Filters button that opens a panel, closed to start with", () => {
    renderPicker();
    expect(screen.getByRole("searchbox", { name: "Search model snapshots" })).toBeTruthy();
    const toggle = filtersToggle();
    const panelId = toggle.getAttribute("aria-controls") as string;
    const panel = document.getElementById(panelId) as HTMLElement;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(panel.hidden).toBe(true);

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(panel.hidden).toBe(false);
    expect(within(panel).getByRole("heading", { name: "Temporal coverage" })).toBeTruthy();
    expect(within(panel).getByRole("heading", { name: "Spatial resolution" })).toBeTruthy();
    expect(within(panel).getByRole("button", { name: "5 arc-min" })).toBeTruthy();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(panel.hidden).toBe(true);
  });

  it("shows how many filter groups are in use on the Filters button, and none when none is", () => {
    const { unmount } = renderPicker();
    expect(filtersToggle().textContent).toBe("Filters");
    unmount();

    renderPicker({ initialFilters: { ...FILTERS, spatialResMin: 0.5, spatialResMax: 0.5 } });
    expect(within(filtersToggle()).getByText("1", { selector: "[aria-hidden]" })).toBeTruthy();
    expect(filtersToggle().textContent).toContain("1 active");
    cleanup();

    renderPicker({
      initialFilters: {
        ...FILTERS,
        temporalCoverageStart: 2000,
        temporalCoverageEnd: null,
        spatialResMin: 0.5,
        spatialResMax: 0.5,
        searchQuery: "wyoming",
      },
    });
    // The search box is not a group.
    expect(within(filtersToggle()).getByText("2", { selector: "[aria-hidden]" })).toBeTruthy();
    expect(filtersToggle().textContent).toContain("2 active");
  });
});

describe("filtering", () => {
  beforeEach(() => vi.useFakeTimers());

  it("searches as one types, after the debounce, and writes the search to the URL", async () => {
    fetchDatasets.mockResolvedValue(page([GLOBAL]));
    renderPicker();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Wyoming" } });
    expect(fetchDatasets).not.toHaveBeenCalled();
    await settle();
    expect(fetchDatasets).toHaveBeenCalledWith(expect.objectContaining({ searchQuery: "Wyoming", page: 1 }));
    expect(window.location.search).toBe("?q=Wyoming");
    // The count says what was asked.
    const count = screen.getByText("1", { selector: "strong" }).parentElement;
    expect(count?.textContent).toBe("1 model snapshot for ‘Wyoming’");
  });

  it("filters by a resolution preset in the panel", async () => {
    fetchDatasets.mockResolvedValue(page([GLOBAL]));
    renderPicker();
    fireEvent.click(filtersToggle());
    fireEvent.click(screen.getByRole("button", { name: "5 arc-min" }));
    await settle();
    expect(fetchDatasets).toHaveBeenCalledWith(
      expect.objectContaining({ spatialResMin: 5 / 60, spatialResMax: 5 / 60 })
    );
    expect(filtersToggle().textContent).toContain("1 active");
    expect(window.location.search).toContain("spatial_res_min=");
  });

  it("clears the search box with its own button", async () => {
    fetchDatasets.mockResolvedValue(page(BIG));
    renderPicker({ initialFilters: { ...FILTERS, searchQuery: "wyo" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
    await settle();
    expect(fetchDatasets).toHaveBeenCalledWith(expect.objectContaining({ searchQuery: "" }));
  });

  it("offers Reset only while something narrows the list, and Reset clears the search and every filter", async () => {
    fetchDatasets.mockResolvedValue(page(BIG));
    const { unmount } = renderPicker();
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
    unmount();

    renderPicker({
      initialFilters: {
        ...FILTERS,
        searchQuery: "wyo",
        temporalCoverageStart: 2000,
        temporalCoverageEnd: 2009,
        spatialResMin: 0.5,
        spatialResMax: 0.5,
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
    await settle();
    expect(fetchDatasets).toHaveBeenCalledWith(
      expect.objectContaining({
        searchQuery: "",
        temporalCoverageStart: null,
        temporalCoverageEnd: null,
        spatialResMin: null,
        spatialResMax: null,
      })
    );
    expect(filtersToggle().textContent).toBe("Filters");
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
  });

  it("says so when nothing matches, and offers Reset there too", async () => {
    renderPicker({ initialFilters: { ...FILTERS, searchQuery: "zzz" } }, page([]));
    expect(screen.getByRole("heading", { name: "No model snapshots found" })).toBeTruthy();
    // The one beside the count, and the one in the empty state.
    expect(screen.getAllByRole("button", { name: "Reset" })).toHaveLength(2);
  });
});

describe("paging and loading", () => {
  beforeEach(() => vi.useFakeTimers());

  it("pages with the pagination, and a page change does not go back to page 1", async () => {
    fetchDatasets.mockResolvedValue({ ...page([TUTORIAL], 3), page: 2 });
    renderPicker({}, page([GLOBAL], 3));
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await settle();
    expect(fetchDatasets).toHaveBeenCalledWith(expect.objectContaining({ page: 2 }));
    expect(window.location.search).toBe("?page=2");
  });

  it("keeps the list on screen while it refetches, and dims it only after 300 ms", async () => {
    let resolve!: (r: RepositoryListResponse) => void;
    fetchDatasets.mockReturnValue(new Promise((r) => (resolve = r)));
    renderPicker();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "wyo" } });
    await settle(); // the debounce: the request is on its way

    const busy = () => document.querySelector("[aria-busy='true']");
    expect(screen.getByRole("list", { name: "Model snapshots" })).toBeTruthy();
    expect(busy()).toBeNull();

    await settle(300);
    expect(busy()).not.toBeNull();
    expect(busy()?.className).toContain("opacity-60");
    // Still the old list.
    expect(screen.getAllByText(LONG_TITLE).length).toBeGreaterThan(0);

    await act(async () => resolve(page([TUTORIAL])));
    expect(busy()).toBeNull();
    expect(screen.queryAllByText(LONG_TITLE)).toHaveLength(0);
    expect(screen.getAllByText("WBM v2.0.0 simulation as tutorial").length).toBeGreaterThan(0);
  });

  it("does not dim for an answer that comes inside 300 ms", async () => {
    fetchDatasets.mockResolvedValue(page([TUTORIAL]));
    renderPicker();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "wyo" } });
    await settle();
    expect(document.querySelector("[aria-busy='true']")).toBeNull();
  });
});

describe("the Details sheet", () => {
  const openGlobal = async () => {
    fireEvent.click(screen.getByRole("button", { name: `Details: ${LONG_TITLE}` }));
    return screen.findByRole("dialog");
  };

  it("opens from a row's Details button with the snapshot's own content, and the list keeps its width", async () => {
    renderPicker();
    expect(screen.queryByRole("dialog")).toBeNull();
    const dialog = await openGlobal();
    expect(within(dialog).getByRole("heading", { name: LONG_TITLE })).toBeTruthy();
    expect(within(dialog).getByText("A model snapshot used only in tests.")).toBeTruthy();
    expect(within(dialog).getByTestId("map")).toBeTruthy();
    expect(within(dialog).getByText("Output variables")).toBeTruthy();
    expect(within(dialog).getByText(/Model input:/).textContent).toContain("not listed in the catalogue");
    const full = within(dialog).getByRole("link", { name: /Full details/ });
    expect(full.getAttribute("href")).toBe("/repository/global");
    expect(full.getAttribute("target")).toBe("_blank");
    // The grid is still there behind it.
    expect(screen.getByRole("list", { name: "Model snapshots", hidden: true })).toBeTruthy();
  });

  it("selects from inside the sheet, and closes it", async () => {
    const { onSelect } = renderPicker();
    const dialog = await openGlobal();
    fireEvent.click(within(dialog).getByRole("button", { name: "Select" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(GLOBAL);
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("closes with its close button and with Escape, without selecting", async () => {
    const { onSelect } = renderPicker();
    let dialog = await openGlobal();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    dialog = await openGlobal();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("stays on the snapshot that was opened when a refetch behind it drops its row", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchDatasets.mockResolvedValue(page([TUTORIAL]));
    renderPicker();
    const dialog = await openGlobal();
    // Behind the sheet, so out of the accessibility tree.
    fireEvent.change(screen.getByRole("searchbox", { hidden: true }), { target: { value: "tutorial" } });
    await settle();
    expect(fetchDatasets).toHaveBeenCalled();
    expect(within(dialog).getByRole("heading", { name: LONG_TITLE })).toBeTruthy();
  });
});
