import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CatalogueSidebar } from "./catalogue-sidebar";
import { clearedFilters, EMPTY_CATALOGUE_FACETS } from "@/lib/repository/catalogue";
import { TEMPORAL_RANGE_BOUNDS } from "@/lib/repository/data";
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

function setup(
  state: CatalogueFilterState = filters(),
  facets: CatalogueFacets = FACETS
) {
  const onChange = vi.fn();
  const onClearAll = vi.fn();
  render(
    <CatalogueSidebar filters={state} facets={facets} onChange={onChange} onClearAll={onClearAll} />
  );
  return { onChange, onClearAll };
}

const group = (name: RegExp) => screen.getByRole("button", { name });

describe("CatalogueSidebar groups", () => {
  it("lists the groups in order, Type first and License last", () => {
    setup();
    const titles = screen
      .getAllByRole("button", { expanded: undefined })
      .map((b) => b.textContent ?? "")
      .filter((t) => /^(Type|Tags|Keyword|Output variable|Forcing data|Temporal coverage|Spatial resolution|Model version|Active processes|Creator|License)/.test(t))
      ;
    expect(titles).toEqual([
      "Type",
      "Tags",
      "Keyword",
      "Temporal coverage",
      "Spatial resolution",
      "Output variable",
      "Forcing data",
      "Model version",
      "Creator",
      "License",
    ]);
  });

  it("opens Type, Tags, Temporal coverage and Spatial resolution and folds the rest", () => {
    setup();
    for (const name of [/^Type/, /^Tags/, /^Temporal coverage/, /^Spatial resolution/]) {
      expect(group(name).getAttribute("aria-expanded")).toBe("true");
    }
    for (const name of [/^Output variable/, /^Forcing data/, /^Model version/, /^Creator/, /^License/]) {
      expect(group(name).getAttribute("aria-expanded")).toBe("false");
    }
  });

  it("opens and closes a group from its chevron button", () => {
    setup();
    const output = group(/^Output variable/);
    expect(screen.queryByRole("checkbox", { name: /Discharge/ })).toBeNull();
    fireEvent.click(output);
    expect(output.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("checkbox", { name: /Discharge/ })).toBeTruthy();
    fireEvent.click(output);
    expect(screen.queryByRole("checkbox", { name: /Discharge/ })).toBeNull();
  });

  it("hides a group with no options but always shows Type", () => {
    setup(filters(), EMPTY_CATALOGUE_FACETS);
    expect(screen.queryByRole("button", { name: /^Active processes/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Tags/ })).toBeNull();
    expect(group(/^Type/)).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Model Snapshot" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Model Input" })).toBeTruthy();
  });

  it("names a group's button by its title and shows + when closed, – when open", () => {
    setup();
    expect(screen.getByRole("button", { name: "Type" }).textContent).toBe("Type");
    expect(screen.getByRole("button", { name: "Output variable" })).toBeTruthy();
    const closed = group(/^Output variable/);
    expect(closed.querySelector("svg.lucide-plus")).not.toBeNull();
    fireEvent.click(closed);
    expect(closed.querySelector("svg.lucide-minus")).not.toBeNull();
    expect(group(/^Type/).querySelector("svg.lucide-minus")).not.toBeNull();
  });

  it("shows each count as a plain number, right-aligned, without parentheses", () => {
    setup();
    const box = screen.getByRole("checkbox", { name: "Model Snapshot 2" });
    const count = box.closest("label")!.lastElementChild as HTMLElement;
    expect(count.textContent).toBe("2");
    expect(count.className).toContain("font-mono");
    expect(box.closest("label")!.textContent).not.toContain("(");
    expect(screen.getByRole("checkbox", { name: "Publication 2" })).toBeTruthy();
  });

  it("humanises forcing roles", () => {
    setup();
    fireEvent.click(group(/^Forcing data/));
    expect(screen.getByRole("checkbox", { name: "Wind (u) 2" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Precipitation 3" })).toBeTruthy();
  });

  it("opens a closed group that already holds a selection", () => {
    setup(filters({ output: ["discharge"] }));
    expect(group(/^Output variable/).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("checkbox", { name: "Discharge 9" }).getAttribute("checked") ?? "").toBe("");
    expect((screen.getByRole("checkbox", { name: "Discharge 9" }) as HTMLInputElement).checked).toBe(true);
  });
});

describe("CatalogueSidebar tags group", () => {
  it("sits right after Type, open, with a readable name and a count on each tag", () => {
    setup();
    const tags = group(/^Tags/);
    expect(tags.getAttribute("aria-expanded")).toBe("true");
    expect(tags.compareDocumentPosition(group(/^Type/)) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    for (const name of ["Publication 2", "Climate forcing 1", "Ancillary data 1", "River network 1"]) {
      expect(screen.getByRole("checkbox", { name })).toBeTruthy();
    }
    expect(screen.queryByRole("checkbox", { name: /^publication/ })).toBeNull();
  });

  it("reports the raw tag value, not its readable name", () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole("checkbox", { name: "River network 1" }));
    expect(onChange).toHaveBeenCalledWith({ tag: ["river-network"] });
  });

  it("stays open with eight options and folds with nine", () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ value: `t-${i}`, label: `t-${i}`, count: 1 }));
    const { unmount } = render(
      <CatalogueSidebar filters={filters()} facets={{ ...FACETS, tag: many(8) }} onChange={vi.fn()} onClearAll={vi.fn()} />
    );
    expect(group(/^Tags/).getAttribute("aria-expanded")).toBe("true");
    unmount();
    render(
      <CatalogueSidebar filters={filters()} facets={{ ...FACETS, tag: many(9) }} onChange={vi.fn()} onClearAll={vi.fn()} />
    );
    expect(group(/^Tags/).getAttribute("aria-expanded")).toBe("false");
  });
});

describe("CatalogueSidebar keyword group", () => {
  it("sits right after Tags, folded when it has more than six options", () => {
    setup();
    const keyword = group(/^Keyword/);
    expect(keyword.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(keyword);
    expect(screen.getByRole("checkbox", { name: "water balance 3" })).toBeTruthy();
    // Seven options: six, then "Show all".
    expect(screen.queryByRole("checkbox", { name: /^soils/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show all (7)" }));
    expect(screen.getByRole("checkbox", { name: "soils 1" })).toBeTruthy();
  });

  it("is open from the start when it has six options or fewer", () => {
    setup(filters(), { ...FACETS, keyword: FACETS.keyword.slice(0, 6) });
    expect(group(/^Keyword/).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("checkbox", { name: "streamflow 1" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
  });

  it("is hidden when the catalogue has no keywords and nothing is selected", () => {
    setup(filters(), { ...FACETS, keyword: [] });
    expect(screen.queryByRole("button", { name: /^Keyword/ })).toBeNull();
  });

  it("reports a ticked keyword as the facet's new selection and counts the selected ones", () => {
    const { onChange } = setup(filters({ keyword: ["storage"] }));
    // A group holding a selection opens by itself.
    expect(group(/^Keyword/).getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("checkbox", { name: "global 2" }));
    expect(onChange).toHaveBeenCalledWith({ keyword: ["storage", "global"] });
  });
});

describe("CatalogueSidebar checkboxes", () => {
  it("reports a ticked box as the facet's new selection", () => {
    const { onChange } = setup(filters({ tag: ["ancillary-data"] }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Publication 2" }));
    expect(onChange).toHaveBeenCalledWith({ tag: ["ancillary-data", "publication"] });
  });

  it("reports an unticked box without the value", () => {
    const { onChange } = setup(filters({ type: ["snapshot", "model-input"] }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Model Snapshot 2" }));
    expect(onChange).toHaveBeenCalledWith({ type: ["model-input"] });
  });

  it("keeps a selected value the facets no longer list, so it can be unticked", () => {
    const { onChange } = setup(filters({ tag: ["gone-tag"] }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Gone tag 0" }));
    expect(onChange).toHaveBeenCalledWith({ tag: [] });
  });
});

describe("CatalogueSidebar Show all", () => {
  it("shows six options, then all of them, then six again", () => {
    setup();
    fireEvent.click(group(/^Output variable/));
    const outputBoxes = () =>
      screen
        .getAllByRole("checkbox")
        .filter((c) =>
          ["Discharge", "Runoff", "Soil moisture", "Evapotranspiration", "Groundwater", "Snow pack", "Irrigation", "Lake storage"].some(
            (n) => c.closest("label")?.textContent?.startsWith(n)
          )
        );
    expect(outputBoxes()).toHaveLength(6);

    const more = screen.getByRole("button", { name: "Show all (8)" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(more);
    expect(outputBoxes()).toHaveLength(8);

    fireEvent.click(screen.getByRole("button", { name: "Show fewer" }));
    expect(outputBoxes()).toHaveLength(6);
  });

  it("offers no toggle for a group of six or fewer", () => {
    setup();
    expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
  });
});

describe("CatalogueSidebar Reset", () => {
  it("is absent when nothing is selected, even with a sort and a view chosen", () => {
    setup(filters({ sortBy: "title-az", view: "grid" }));
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
  });

  it.each([
    ["a facet value", filters({ license: ["CC-BY-4.0"] })],
    ["a year", filters({ yearStart: 2000 })],
    ["a resolution", filters({ spatialResMax: 0.5 })],
    ["a search", filters({ searchQuery: "storage" })],
  ])("appears for %s and clears when pressed", (_name, state) => {
    const { onClearAll } = setup(state);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it("is what clearedFilters answers: the filters off, the sort and the view kept", () => {
    const state = filters({ license: ["CC-BY-4.0"], sortBy: "coverage-start", view: "grid", page: 3 });
    expect(clearedFilters(state)).toEqual(filters({ sortBy: "coverage-start", view: "grid" }));
  });
});

describe("CatalogueSidebar has no search box", () => {
  it("leaves the search to the toolbar above the results", () => {
    setup();
    expect(screen.queryByRole("searchbox")).toBeNull();
  });
});

describe("CatalogueSidebar temporal coverage", () => {
  const year = (name: string) => screen.getByLabelText(name) as HTMLInputElement;

  it("spans the catalogue's year bounds", () => {
    setup();
    expect(year("From").value).toBe("1990");
    expect(year("To").value).toBe("2020");
    expect(screen.getByRole("slider", { name: "Earliest year" })).toBeTruthy();
    expect(screen.getByRole("slider", { name: "Latest year" })).toBeTruthy();
  });

  it("falls back on the fixed range when the catalogue reports none", () => {
    setup(filters(), { ...FACETS, yearBounds: null });
    expect(year("From").value).toBe(String(TEMPORAL_RANGE_BOUNDS.min));
    expect(year("To").value).toBe(String(TEMPORAL_RANGE_BOUNDS.max));
  });

  it("applies a typed year on blur and leaves the other end open", () => {
    const { onChange } = setup();
    fireEvent.change(year("From"), { target: { value: "2000" } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(year("From"));
    expect(onChange).toHaveBeenCalledWith({ yearStart: 2000, yearEnd: null });
  });

  it("clamps a typed year to the bounds and applies on Enter", () => {
    const { onChange } = setup(filters({ yearStart: 2000 }));
    fireEvent.change(year("To"), { target: { value: "2500" } });
    fireEvent.keyDown(year("To"), { key: "Enter" });
    // 2500 is clamped to the last year, which is no limit at all.
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(year("To"), { target: { value: "2005" } });
    fireEvent.keyDown(year("To"), { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith({ yearStart: 2000, yearEnd: 2005 });
  });

  it("moves the other end along when From passes To", () => {
    const { onChange } = setup(filters({ yearStart: 1995, yearEnd: 2000 }));
    fireEvent.change(year("From"), { target: { value: "2010" } });
    fireEvent.blur(year("From"));
    expect(onChange).toHaveBeenCalledWith({ yearStart: 2010, yearEnd: 2010 });
  });
});

describe("CatalogueSidebar spatial resolution", () => {
  it("offers the presets as mono chips with Finest and Coarsest under them, and no slider or unit toggle", () => {
    setup();
    for (const label of ["30 arc-sec", "5 arc-min", "15 arc-min", "0.5°", "1°"]) {
      const chip = screen.getByRole("button", { name: label });
      expect(chip.className).toContain("font-mono");
      expect(chip.className).toContain("rounded-full");
      expect(chip.getAttribute("aria-pressed")).toBe("false");
    }
    expect(screen.getByText("Finest")).toBeTruthy();
    expect(screen.getByText("Coarsest")).toBeTruthy();
    expect(screen.queryByRole("slider", { name: /resolution/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Arc-minutes" })).toBeNull();
  });

  it("applies a preset as an exact resolution", () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: "0.5°" }));
    expect(onChange).toHaveBeenCalledWith({ spatialResMin: 0.5, spatialResMax: 0.5 });
  });

  it("marks only the active preset as pressed and removes it on a second press", () => {
    const { onChange } = setup(filters({ spatialResMin: 0.5, spatialResMax: 0.5 }));
    const preset = screen.getByRole("button", { name: "0.5°" });
    expect(preset.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "1°" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(preset);
    expect(onChange).toHaveBeenCalledWith({ spatialResMin: null, spatialResMax: null });
  });

  it("replaces the active preset when another is pressed", () => {
    const { onChange } = setup(filters({ spatialResMin: 0.5, spatialResMax: 0.5 }));
    fireEvent.click(screen.getByRole("button", { name: "1°" }));
    expect(onChange).toHaveBeenCalledWith({ spatialResMin: 1, spatialResMax: 1 });
  });
});

describe("CatalogueSidebar on a phone", () => {
  it("folds the filters behind a Filters button that says how many are active", () => {
    setup(filters({ tag: ["publication"], yearStart: 2000 }));
    const toggle = screen.getByRole("button", { name: /^Filters/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toContain("2");
    expect(toggle.className).toContain("lg:hidden");
    expect(toggle.className).toContain("h-11");

    const panel = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
    expect(panel?.className).toContain("hidden");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(panel?.className).not.toMatch(/(^|\s)hidden(\s|$)/);
    // From lg the panel is always shown.
    expect(panel?.className).toContain("lg:flex");
  });

  it("takes its natural height: no sticky box and no inner scroll", () => {
    setup();
    const wrapper = document.querySelector("aside > div");
    expect(wrapper?.className).not.toContain("sticky");
    expect(wrapper?.className).not.toContain("max-h-");
    expect(document.querySelector(".overflow-y-auto")).toBeNull();
  });

  it("gives every checkbox row a 40 px touch target", () => {
    setup();
    const label = screen.getByRole("checkbox", { name: "Publication 2" }).closest("label");
    expect(label?.className).toContain("min-h-10");
  });
});
