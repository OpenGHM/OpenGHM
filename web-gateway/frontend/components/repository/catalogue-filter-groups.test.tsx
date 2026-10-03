import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
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
    expect(sidebarTitles(filters(), empty)).toEqual(["Type", "Temporal coverage", "Spatial resolution"]);
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
    }

    it("shows in both when it is flagged for the picker", () => {
      withGroup(extra(true), () => {
        expect(sidebarTitles(state, withExtra)).toContain("Study region");
        expect(pickerTitles(state, withExtra)).toContain("Study region");
      });
    });

    it("shows only in the sidebar when it is not", () => {
      withGroup(extra(false), () => {
        expect(sidebarTitles(state, withExtra)).toContain("Study region");
        expect(pickerTitles(state, withExtra)).not.toContain("Study region");
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
    expect(container.querySelector("#catalogue-year-from")).not.toBeNull();
    expect(container.querySelector("button[aria-pressed]")).not.toBeNull();
  });
});
