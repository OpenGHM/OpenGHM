import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { CatalogueSidebar } from "./catalogue-sidebar";
import { SnapshotPickerFilters } from "@/components/workspace/snapshot-picker-filters";
import {
  CATALOGUE_FILTER_GROUPS,
  pickerFilterGroups,
  visibleFilterGroups,
  type CatalogueFilterGroup,
} from "@/lib/repository/catalogue";
import type { CatalogueFacets, CatalogueFilterState } from "@/lib/repository/types";
import { FACETS, filters } from "./catalogue.fixtures";

// The sliders read ResizeObserver, which jsdom does not have.
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(cleanup);

/**
 * The Data Repository's sidebar and the snapshot picker's panel are two layouts
 * of one definition (`CATALOGUE_FILTER_GROUPS`). These tests are the contract:
 * which filters there are is not decided in either component.
 */

/** The titles of the sidebar's groups, top to bottom. */
function sidebarTitles(state: CatalogueFilterState, facets: CatalogueFacets): string[] {
  const { container } = render(
    <CatalogueSidebar filters={state} facets={facets} onChange={vi.fn()} onClearAll={vi.fn()} />
  );
  const titles = [...container.querySelectorAll('[role="group"][id$="-panel"]')].map(
    (g) => document.getElementById(g.getAttribute("aria-labelledby") as string)?.textContent ?? ""
  );
  cleanup();
  return titles;
}

/** The headings of the picker's panel, in order. */
function pickerTitles(state: CatalogueFilterState, facets: CatalogueFacets): string[] {
  const { container } = render(
    <SnapshotPickerFilters filters={state} facets={facets} onChange={vi.fn()} />
  );
  const titles = [...container.querySelectorAll("section h3")].map((h) => h.textContent ?? "");
  cleanup();
  return titles;
}

/** Opens the compact panel, then the dialog from its More filters button. */
function openMoreFilters() {
  fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
  fireEvent.click(screen.getByRole("button", { name: /^More filters/ }));
}

/** The headings of the picker's "More filters" dialog, in order (the dialog is in a portal, so the document is searched). */
function dialogTitles(state: CatalogueFilterState, facets: CatalogueFacets): string[] {
  render(<SnapshotPickerFilters filters={state} facets={facets} onChange={vi.fn()} />);
  openMoreFilters();
  const dialog = screen.getByRole("dialog", { name: "Filters" });
  const titles = [...dialog.querySelectorAll('[role="group"][id$="-panel"]')].map(
    (g) => document.getElementById(g.getAttribute("aria-labelledby") as string)?.textContent ?? ""
  );
  cleanup();
  return titles;
}

const PICKER_TITLES = ["Tags", "Temporal coverage", "Spatial resolution"];

describe("the sidebar and the picker's panel share their filter groups", () => {
  it("show in the picker exactly the sidebar's flagged groups, in the sidebar's order, less the fixed type", () => {
    const sidebar = sidebarTitles(filters(), FACETS);
    const flagged = new Set(CATALOGUE_FILTER_GROUPS.filter((g) => g.picker).map((g) => g.title));
    expect(sidebar[0]).toBe("Type");
    const picker = pickerTitles(filters(), FACETS);
    expect(picker).toEqual(sidebar.filter((t) => t !== "Type" && flagged.has(t)));
    // Not a vacuous match: the compact three, and the others stay in the sidebar only.
    expect(picker).toEqual(PICKER_TITLES);
    expect(sidebar.length).toBeGreaterThan(PICKER_TITLES.length + 1);
  });

  it("agree on a flagged group with nothing to list: absent from both, and in both once something is selected", () => {
    const facets = { ...FACETS, tag: [] };
    expect(sidebarTitles(filters(), facets)).not.toContain("Tags");
    expect(pickerTitles(filters(), facets)).not.toContain("Tags");
    const selected = filters({ tag: ["publication"] });
    expect(sidebarTitles(selected, facets)).toContain("Tags");
    expect(pickerTitles(selected, facets)).toContain("Tags");
  });

  it("agree when the facets are empty", () => {
    const empty: CatalogueFacets = {
      ...FACETS,
      type: [],
      tag: [],
      keyword: [],
      output: [],
      forcing: [],
      wbm: [],
      process: [],
      creator: [],
      license: [],
    };
    expect(sidebarTitles(filters(), empty)).toEqual([
      "Type",
      "Temporal coverage",
      "Spatial resolution",
      "Region",
    ]);
    expect(pickerTitles(filters(), empty)).toEqual(["Temporal coverage", "Spatial resolution"]);
  });

  it("never offer the type in the picker, selected or not, even if it were flagged", () => {
    expect(pickerTitles(filters({ type: ["snapshot"] }), FACETS)).not.toContain("Type");
    const groups = CATALOGUE_FILTER_GROUPS as CatalogueFilterGroup[];
    const type = groups.find((g) => g.key === "type") as CatalogueFilterGroup;
    type.picker = true;
    try {
      expect(pickerTitles(filters(), FACETS)).not.toContain("Type");
      expect(pickerFilterGroups(FACETS, filters()).map((g) => g.key)).not.toContain("type");
    } finally {
      type.picker = false;
    }
  });

  it("give both the titles the definition holds", () => {
    const all = visibleFilterGroups(FACETS, filters({ process: ["irrigation"] })).map((g) => g.title);
    expect(sidebarTitles(filters({ process: ["irrigation"] }), FACETS)).toEqual(all);
  });

  it("show in the picker's dialog every sidebar group but the fixed type, in the sidebar's order", () => {
    const sidebar = sidebarTitles(filters(), FACETS);
    const dialog = dialogTitles(filters(), FACETS);
    expect(dialog).toEqual(sidebar.filter((t) => t !== "Type"));
    // Not a vacuous match: it holds the filters the compact panel does not.
    expect(dialog).toEqual(expect.arrayContaining([...PICKER_TITLES, "Keyword", "Output variable", "License"]));
    expect(dialog.length).toBeGreaterThan(PICKER_TITLES.length);
    expect(dialog).not.toContain("Type");
  });

  it("show the dialog's groups open as the definition says, and the compact ones among them", () => {
    render(<SnapshotPickerFilters filters={filters()} facets={FACETS} onChange={vi.fn()} />);
    openMoreFilters();
    const dialog = screen.getByRole("dialog", { name: "Filters" });
    const expanded = (title: string) =>
      within(dialog).getByRole("button", { name: title }).getAttribute("aria-expanded");
    expect(expanded("Temporal coverage")).toBe("true");
    expect(expanded("Spatial resolution")).toBe("true");
    expect(expanded("License")).toBe("false");
    expect(expanded("Output variable")).toBe("false");
  });

  it("has no More filters button when the compact panel already has every group", () => {
    const only: CatalogueFacets = {
      ...FACETS,
      keyword: [],
      output: [],
      forcing: [],
      wbm: [],
      process: [],
      creator: [],
      license: [],
    };
    // Region is a group the compact panel lacks, so with it in the definition
    // the button is there; take it out to see the case this test is about.
    const groups = CATALOGUE_FILTER_GROUPS as CatalogueFilterGroup[];
    const region = groups.find((g) => g.key === "region") as CatalogueFilterGroup;
    const at = groups.indexOf(region);
    groups.splice(at, 1);
    try {
      render(<SnapshotPickerFilters filters={filters()} facets={only} onChange={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
      expect(screen.queryByRole("button", { name: /^More filters/ })).toBeNull();
    } finally {
      groups.splice(at, 0, region);
    }
  });

  describe("a group added to the definition", () => {
    // A facet the API does not have yet, as a future one would be.
    const withExtra = {
      ...FACETS,
      region: [{ value: "global", label: "Global", count: 3 }],
    } as unknown as CatalogueFacets;
    const state = { ...filters(), region: [] } as unknown as CatalogueFilterState;
    const extra = (picker: boolean) =>
      ({ kind: "facet", key: "region", title: "Study region", picker, defaultOpen: false }) as unknown as CatalogueFilterGroup;

    function withGroup(group: CatalogueFilterGroup, run: () => void) {
      const groups = CATALOGUE_FILTER_GROUPS as CatalogueFilterGroup[];
      groups.push(group);
      try {
        run();
      } finally {
        groups.pop();
      }
      expect(sidebarTitles(state, withExtra)).not.toContain("Study region");
      expect(pickerTitles(state, withExtra)).not.toContain("Study region");
      expect(dialogTitles(state, withExtra)).not.toContain("Study region");
    }

    it("shows in the sidebar, the compact panel and the dialog when it is flagged for the picker", () => {
      withGroup(extra(true), () => {
        expect(sidebarTitles(state, withExtra)).toContain("Study region");
        expect(pickerTitles(state, withExtra)).toContain("Study region");
        expect(dialogTitles(state, withExtra)).toContain("Study region");
      });
    });

    it("shows in the sidebar and the dialog, not in the compact panel, when it is not", () => {
      withGroup(extra(false), () => {
        expect(sidebarTitles(state, withExtra)).toContain("Study region");
        expect(pickerTitles(state, withExtra)).not.toContain("Study region");
        expect(dialogTitles(state, withExtra)).toContain("Study region");
      });
    });

    it("is counted on the More filters button when it is not in the compact panel", () => {
      const selected = { ...state, region: ["global"] } as unknown as CatalogueFilterState;
      const badge = () => screen.getByRole("button", { name: /^More filters/ }).textContent;
      withGroup(extra(false), () => {
        render(<SnapshotPickerFilters filters={selected} facets={withExtra} onChange={vi.fn()} />);
        fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
        expect(badge()).toContain("1 active");
        cleanup();
      });
    });
  });

  it("takes a group out of both when it is taken out of the definition", () => {
    const groups = CATALOGUE_FILTER_GROUPS as CatalogueFilterGroup[];
    const at = groups.findIndex((g) => g.key === "tag");
    const [removed] = groups.splice(at, 1);
    try {
      expect(sidebarTitles(filters(), FACETS)).not.toContain("Tags");
      expect(pickerTitles(filters(), FACETS)).not.toContain("Tags");
    } finally {
      groups.splice(at, 0, removed);
    }
    expect(pickerTitles(filters(), FACETS)).toContain("Tags");
  });

  it("render the shared widgets in the picker's panel", () => {
    const { container } = render(
      <SnapshotPickerFilters filters={filters()} facets={FACETS} onChange={vi.fn()} />
    );
    expect(container.querySelectorAll('input[type="checkbox"]').length).toBeGreaterThan(2);
    expect(container.querySelector('input[type="number"]')).not.toBeNull();
    expect(container.querySelector("button[aria-pressed]")).not.toBeNull();
  });
});
