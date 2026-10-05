import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const { fetchSnapshots, fetchModelInputIds } = vi.hoisted(() => ({
  fetchSnapshots: vi.fn(),
  fetchModelInputIds: vi.fn(),
}));
// The address bar is the router: what the hook pushes is what `useSearchParams` reads.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("@/lib/repository/actions", () => ({ fetchSnapshots, fetchModelInputIds }));
// The map is Leaflet, which jsdom cannot draw.
vi.mock("@/components/repository/bounding-box-map-dynamic", () => ({
  BoundingBoxMap: () => <div data-testid="map" />,
}));

import { filters as catalogueFilters, response } from "@/components/repository/catalogue.fixtures";
import { SnapshotPicker } from "@/components/workspace/snapshot-picker";
import { fakeDataset } from "@/lib/workspace/fixtures";
import type { CatalogueResponse, Dataset } from "@/lib/repository/types";

// The filter sliders read ResizeObserver, which jsdom does not have.
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
beforeEach(() => {
  fetchSnapshots.mockReset();
  fetchModelInputIds.mockReset();
  fetchModelInputIds.mockResolvedValue(new Set());
  window.history.replaceState(null, "", "/workspace/new");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const FILTERS = catalogueFilters();

const LONG_TITLE =
  "WBM v1.0.0 Global_tracking snapshot draft for 'Water balance model (WBM) v.1.0.0: a scalable gridded global hydrologic model with water-tracking functionality': [Global] [2000-2009]";

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
/** More snapshots than one short list: the first two are the ones above. */
const BIG = [
  GLOBAL,
  TUTORIAL,
  ...Array.from({ length: 8 }, (_, i) => named(`more-${i}`, `Snapshot ${i}`, `3.${i}.0`, ["2001", "2001"])),
];

/** An answer of the catalogue for the snapshots `items`, with the repository's facets. */
const page = (items: Dataset[], totalPages = 1): CatalogueResponse =>
  response(
    items.map((item) => ({ ...item, kind: "snapshot" as const })),
    { totalPages }
  );

function renderPicker(
  over: Partial<React.ComponentProps<typeof SnapshotPicker>> = {},
  data: CatalogueResponse = page(BIG)
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
    expect(within(items[0]).getByRole("heading", { level: 3 }).textContent).toBe(LONG_TITLE);
    expect(items[0].textContent).toContain("WBM 1.0.0 · 2000–2009 · 5 arc-min");
    expect(items[1].textContent).toContain("Tutorial");
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("selects from a card's title, and Details does not select", () => {
    const { onSelect } = renderPicker();
    fireEvent.click(within(snapshotCard(TUTORIAL.about.name)).getByRole("button", { name: TUTORIAL.about.name }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "tutorial" }));
    fireEvent.click(screen.getByRole("button", { name: `Details: ${LONG_TITLE}` }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("turns the cards off and covers the clicked one while a draft is being made", () => {
    renderPicker({ pendingId: "global", disabled: true });
    expect(screen.getByRole("status").textContent).toContain("Opening");
    expect((screen.getAllByRole("button", { name: /^WBM / })[0] as HTMLButtonElement).disabled).toBe(true);
  });

  it("colours the chips with tokens, not raw palette classes", () => {
    const { container } = renderPicker();
    expect(container.innerHTML).not.toMatch(/#006994|emerald|amber/);
  });
});

describe("the snapshots the user has used", () => {
  const cardTitles = () =>
    within(screen.getByRole("list", { name: "Model snapshots" }))
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent);

  it("are marked, and listed first when nothing orders the list", () => {
    renderPicker({ usedIds: new Set(["more-3"]) });
    expect(cardTitles()[0]).toBe("Snapshot 3");
    expect(screen.getAllByText("Used before")).toHaveLength(1);
  });

  it("are still marked in a search, which keeps the order the repository ranked it in", () => {
    renderPicker({ initialFilters: { ...FILTERS, searchQuery: "snapshot" }, usedIds: new Set(["more-3"]) });
    expect(cardTitles()[0]).toBe(LONG_TITLE);
    expect(cardTitles()[5]).toBe("Snapshot 3");
    expect(screen.getAllByText("Used before")).toHaveLength(1);
  });

  it("are not moved to the front of one page of several, which would move different ones on every page", () => {
    renderPicker({ usedIds: new Set(["more-3"]) }, page(BIG, 2));
    expect(cardTitles()[0]).toBe(LONG_TITLE);
    expect(screen.getAllByText("Used before")).toHaveLength(1);
  });
});

describe("search and filters", () => {
  it("are always there, even for a short catalogue", () => {
    renderPicker({}, page([GLOBAL, TUTORIAL, named("third", "Third", "1.0.0", ["2000", "2009"])]));
    expect(screen.getByRole("searchbox", { name: "Search model snapshots" })).toBeTruthy();
    expect(filtersToggle()).toBeTruthy();
    // And the count, as the repository has it.
    expect(screen.getByText("3", { selector: "strong" }).parentElement?.textContent).toBe("3 model snapshots");
  });

  it("has a placeholder short enough for a phone's search box", () => {
    renderPicker();
    expect((screen.getByRole("searchbox") as HTMLInputElement).placeholder).toBe("Search snapshots…");
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
    expect(within(panel).getByRole("heading", { name: "Tags" })).toBeTruthy();
    expect(within(panel).getByRole("heading", { name: "Temporal coverage" })).toBeTruthy();
    expect(within(panel).getByRole("heading", { name: "Spatial resolution" })).toBeTruthy();
    expect(within(panel).getByRole("button", { name: "5 arc-min" })).toBeTruthy();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(panel.hidden).toBe(true);
  });

  it("lists the tags the repository counts for snapshots, with their counts, in the panel", () => {
    renderPicker();
    fireEvent.click(filtersToggle());
    const panel = document.getElementById(filtersToggle().getAttribute("aria-controls") as string) as HTMLElement;
    const tags = within(panel).getByRole("heading", { name: "Tags" }).parentElement as HTMLElement;
    expect(within(tags).getByRole("checkbox", { name: /Publication/ })).toBeTruthy();
    expect(within(tags).getByRole("checkbox", { name: /Climate forcing/ })).toBeTruthy();
    expect(within(tags).getByText("2")).toBeTruthy();
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
        tag: ["tutorial"],
        yearStart: 2000,
        yearEnd: null,
        spatialResMin: 0.5,
        spatialResMax: 0.5,
        searchQuery: "wyoming",
      },
    });
    // The search box is not a group; each tag counts.
    expect(within(filtersToggle()).getByText("3", { selector: "[aria-hidden]" })).toBeTruthy();
    expect(filtersToggle().textContent).toContain("3 active");
  });
});

describe("filtering", () => {
  beforeEach(() => vi.useFakeTimers());

  it("searches as one types, after the debounce, and writes the search to the URL", async () => {
    fetchSnapshots.mockResolvedValue(page([GLOBAL]));
    renderPicker();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Wyoming" } });
    expect(fetchSnapshots).not.toHaveBeenCalled();
    await settle();
    expect(fetchSnapshots).toHaveBeenCalledWith(expect.objectContaining({ searchQuery: "Wyoming", page: 1 }));
    expect(window.location.search).toBe("?q=Wyoming");
    // The count says what was asked.
    const count = screen.getByText("1", { selector: "strong" }).parentElement;
    expect(count?.textContent).toBe("1 model snapshot for ‘Wyoming’");
  });

  it("filters by a tag in the panel, and says so with a chip that takes it off again", async () => {
    fetchSnapshots.mockResolvedValue(page([TUTORIAL]));
    renderPicker();
    fireEvent.click(filtersToggle());
    fireEvent.click(screen.getByRole("checkbox", { name: /Publication/ }));
    await settle();
    expect(fetchSnapshots).toHaveBeenCalledWith(expect.objectContaining({ tag: ["publication"], page: 1 }));
    expect(window.location.search).toBe("?tag=publication");
    expect(filtersToggle().textContent).toContain("1 active");

    fetchSnapshots.mockResolvedValue(page(BIG));
    fireEvent.click(screen.getByRole("button", { name: "Remove filter: Tag: Publication" }));
    await settle();
    expect(fetchSnapshots).toHaveBeenLastCalledWith(expect.objectContaining({ tag: [] }));
    expect(window.location.search).toBe("");
  });

  it("offers only the compact groups in the panel, never the type, and so does not count a link's other facets", async () => {
    fetchSnapshots.mockResolvedValue(page([GLOBAL]));
    renderPicker();
    fireEvent.click(filtersToggle());
    const panel = document.getElementById(filtersToggle().getAttribute("aria-controls") as string) as HTMLElement;
    expect(within(panel).getAllByRole("heading").map((h) => h.textContent)).toEqual([
      "Tags",
      "Temporal coverage",
      "Spatial resolution",
    ]);
  });

  it("filters by a resolution preset in the panel", async () => {
    fetchSnapshots.mockResolvedValue(page([GLOBAL]));
    renderPicker();
    fireEvent.click(filtersToggle());
    fireEvent.click(screen.getByRole("button", { name: "5 arc-min" }));
    await settle();
    expect(fetchSnapshots).toHaveBeenCalledWith(
      expect.objectContaining({ spatialResMin: 5 / 60, spatialResMax: 5 / 60 })
    );
    expect(filtersToggle().textContent).toContain("1 active");
    expect(window.location.search).toContain("spatial_res_min=");
  });

  it("clears the search box with its own button", async () => {
    fetchSnapshots.mockResolvedValue(page(BIG));
    renderPicker({ initialFilters: { ...FILTERS, searchQuery: "wyo" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
    await settle();
    expect(fetchSnapshots).toHaveBeenCalledWith(expect.objectContaining({ searchQuery: "" }));
  });

  it("offers Clear all only while something narrows the list, and it clears the search and every filter", async () => {
    fetchSnapshots.mockResolvedValue(page(BIG));
    const { unmount } = renderPicker();
    expect(screen.queryByRole("button", { name: "Clear all" })).toBeNull();
    unmount();

    renderPicker({
      initialFilters: {
        ...FILTERS,
        searchQuery: "wyo",
        tag: ["tutorial"],
        yearStart: 2000,
        yearEnd: 2009,
        spatialResMin: 0.5,
        spatialResMax: 0.5,
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
    await settle();
    expect(fetchSnapshots).toHaveBeenCalledWith(
      expect.objectContaining({
        searchQuery: "",
        tag: [],
        yearStart: null,
        yearEnd: null,
        spatialResMin: null,
        spatialResMax: null,
      })
    );
    expect(filtersToggle().textContent).toBe("Filters");
    expect(screen.queryByRole("button", { name: "Clear all" })).toBeNull();
  });

  it("says so when nothing matches, and Clear filters there brings the list back", async () => {
    fetchSnapshots.mockResolvedValue(page(BIG));
    renderPicker({ initialFilters: { ...FILTERS, searchQuery: "zzz" } }, page([]));
    expect(screen.getByRole("heading", { name: "No model snapshots match" })).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Model snapshots" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await settle();
    expect(fetchSnapshots).toHaveBeenCalledWith(expect.objectContaining({ searchQuery: "" }));
    expect(screen.getByRole("list", { name: "Model snapshots" })).toBeTruthy();
  });

  it("says nothing is published, with no way to clear, when there are no filters and no snapshots", () => {
    renderPicker({}, page([]));
    expect(screen.getByRole("heading", { name: "No model snapshots have been published yet" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
  });

  it("says it could not load, keeps the search, and Retry asks again", async () => {
    fetchSnapshots.mockRejectedValueOnce(new Error("down")).mockResolvedValue(page(BIG));
    renderPicker();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "wbm" } });
    await settle();
    expect(screen.getByRole("alert").textContent).toContain("Model snapshots could not be loaded");
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("wbm");
    // The panel keeps its tags from the last good answer.
    fireEvent.click(filtersToggle());
    expect(screen.getByRole("checkbox", { name: /Publication/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await settle(0);
    expect(fetchSnapshots).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("starts in the error state when the server could not read the first page", () => {
    renderPicker({ initialError: true }, page([]));
    expect(screen.getByRole("alert").textContent).toContain("could not be loaded");
  });
});

describe("the More filters dialog", () => {
  // Behind the open dialog the page is aria-hidden: look past it for the buttons under it.
  const moreButton = () => screen.getByRole("button", { name: /^More filters/, hidden: true });
  const toggle = () => screen.getByRole("button", { name: /^Filters/, hidden: true });
  const openDialog = () => {
    if (toggle().getAttribute("aria-expanded") !== "true") fireEvent.click(toggle());
    fireEvent.click(moreButton());
    return screen.getByRole("dialog", { name: "Filters" });
  };

  it("opens from the panel with every filter group of the repository but the type, and Escape closes it", () => {
    renderPicker();
    expect(screen.queryByRole("dialog")).toBeNull();
    const dialog = openDialog();
    for (const title of ["Tags", "Keyword", "Temporal coverage", "Spatial resolution", "Output variable", "License"]) {
      expect(within(dialog).getByRole("button", { name: title })).toBeTruthy();
    }
    expect(within(dialog).queryByRole("button", { name: "Type" })).toBeNull();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("filters by a keyword and an output variable, with chips, the URL and a badge on the button", async () => {
    vi.useFakeTimers();
    fetchSnapshots.mockResolvedValue(page([TUTORIAL]));
    renderPicker();
    const dialog = openDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Keyword" }));
    fireEvent.click(within(dialog).getAllByRole("checkbox", { name: /storage/ })[0]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Output variable" }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Discharge/ }));
    await settle();
    expect(fetchSnapshots).toHaveBeenLastCalledWith(
      expect.objectContaining({ keyword: ["storage"], output: ["discharge"], page: 1 })
    );
    expect(window.location.search).toBe("?keyword=storage&output=discharge");
    expect(screen.getByRole("button", { name: "Remove filter: Keyword: storage", hidden: true })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove filter: Output: Discharge", hidden: true })).toBeTruthy();
    expect(toggle().textContent).toContain("2 active");
    // The button behind the dialog counts what only the dialog has.
    expect(moreButton().textContent).toContain("2 active");
  });

  it("starts from the filters of a copied link, however far from the compact panel", () => {
    renderPicker({ initialFilters: { ...FILTERS, license: ["GPL-3.0-only"] } });
    fireEvent.click(toggle());
    expect(moreButton().textContent).toContain("1 active");
    expect(screen.getByRole("button", { name: "Remove filter: License: GPL-3.0-only", hidden: true })).toBeTruthy();
    // A group with a selection is open when the dialog opens.
    const dialog = openDialog();
    expect(within(dialog).getByRole("button", { name: "License" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("offers Show N snapshots, which closes it, and Reset, which clears every filter but keeps the search", async () => {
    vi.useFakeTimers();
    fetchSnapshots.mockResolvedValue(page(BIG));
    renderPicker({
      initialFilters: { ...FILTERS, searchQuery: "snap", keyword: ["storage"], tag: ["tutorial"], yearStart: 2000 },
    });
    const dialog = openDialog();
    expect(within(dialog).getByRole("button", { name: "Show 10 snapshots" })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset" }));
    await settle();
    expect(fetchSnapshots).toHaveBeenLastCalledWith(
      expect.objectContaining({ searchQuery: "snap", keyword: [], tag: [], yearStart: null })
    );
    expect(window.location.search).toBe("?q=snap");
    expect(toggle().textContent).toBe("Filters");
    expect((within(dialog).getByRole("button", { name: "Reset" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(within(dialog).getByRole("button", { name: /^Show \d+ snapshots?$/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is left out of the page's own ids: the panel and the dialog do not share an element id", () => {
    renderPicker();
    openDialog();
    const ids = [...document.querySelectorAll("[id]")].map((e) => e.id);
    expect(ids.length).toBe(new Set(ids).size);
  });
});

describe("paging and loading", () => {
  beforeEach(() => vi.useFakeTimers());

  it("pages with the pagination, and a page change does not go back to page 1", async () => {
    fetchSnapshots.mockResolvedValue({ ...page([TUTORIAL], 3), page: 2 });
    renderPicker({}, page([GLOBAL], 3));
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await settle();
    expect(fetchSnapshots).toHaveBeenCalledWith(expect.objectContaining({ page: 2 }));
    expect(window.location.search).toBe("?page=2");
  });

  it("keeps the list on screen while it refetches, and dims it only after 300 ms", async () => {
    let resolve!: (r: CatalogueResponse) => void;
    fetchSnapshots.mockReturnValue(new Promise((r) => (resolve = r)));
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
    fetchSnapshots.mockResolvedValue(page([TUTORIAL]));
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
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "global" }));
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
    fetchSnapshots.mockResolvedValue(page([TUTORIAL]));
    renderPicker();
    const dialog = await openGlobal();
    // Behind the sheet, so out of the accessibility tree.
    fireEvent.change(screen.getByRole("searchbox", { hidden: true }), { target: { value: "tutorial" } });
    await settle();
    expect(fetchSnapshots).toHaveBeenCalled();
    expect(within(dialog).getByRole("heading", { name: LONG_TITLE })).toBeTruthy();
  });
});
