import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
    expect(screen.getByRole("button", { name: "Model Snapshot" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Model Input" })).toBeTruthy();
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

  it("shows each count as a plain number in a pill, right-aligned, without parentheses", () => {
    setup();
    const box = screen.getByRole("checkbox", { name: "Publication 2" });
    const count = box.closest("label")!.lastElementChild as HTMLElement;
    expect(count.textContent).toBe("2");
    expect(count.className).toContain("font-mono");
    expect(count.className).toContain("rounded-full");
    expect(box.closest("label")!.textContent).not.toContain("(");
  });

  it("offers Type as a two-button segmented control, each kind with its count", () => {
    setup(filters({ type: ["snapshot"] }));
    const snapshot = screen.getByRole("button", { name: "Model Snapshot 2" });
    const input = screen.getByRole("button", { name: "Model Input 1" });
    expect(snapshot.getAttribute("aria-pressed")).toBe("true");
    expect(input.getAttribute("aria-pressed")).toBe("false");
    expect(snapshot.lastElementChild?.textContent).toBe("2");
    expect(snapshot.parentElement).toBe(input.parentElement);
    expect(screen.queryByRole("checkbox", { name: /^Model (Snapshot|Input)/ })).toBeNull();
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
    const { onChange } = setup(filters({ tag: ["publication", "climate-forcing"] }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Publication 2" }));
    expect(onChange).toHaveBeenCalledWith({ tag: ["climate-forcing"] });
  });

  it("adds a kind to the Type filter, and takes it off again, with its segmented button", () => {
    const { onChange } = setup(filters({ type: ["snapshot"] }));
    fireEvent.click(screen.getByRole("button", { name: "Model Input 1" }));
    expect(onChange).toHaveBeenLastCalledWith({ type: ["snapshot", "model-input"] });
    fireEvent.click(screen.getByRole("button", { name: "Model Snapshot 2" }));
    expect(onChange).toHaveBeenLastCalledWith({ type: [] });
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
    ["a region", filters({ boxNorth: 45, boxSouth: 40, boxEast: -100, boxWest: -110 })],
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

describe("CatalogueSidebar temporal coverage handles", () => {
  it("shows the bounds again after a keyboard step and a Reset, not the stepped year", () => {
    const ui = (state: CatalogueFilterState) => (
      <CatalogueSidebar filters={state} facets={FACETS} onChange={vi.fn()} onClearAll={vi.fn()} />
    );
    const from = () => screen.getByLabelText("From") as HTMLInputElement;
    const earliest = () => screen.getByRole("slider", { name: "Earliest year" });
    const { rerender } = render(ui(filters()));
    fireEvent.focus(earliest());
    fireEvent.keyDown(earliest(), { key: "ArrowRight" });
    expect(from().value).toBe("1991");
    // The URL catches up with the step ...
    rerender(ui(filters({ yearStart: 1991 })));
    expect(from().value).toBe("1991");
    // ... and Reset puts the filter back where the draft was made.
    rerender(ui(filters()));
    expect(from().value).toBe("1990");
    expect(earliest().getAttribute("aria-valuenow")).toBe("1990");
  });
});

describe("CatalogueSidebar spatial resolution", () => {
  const FIVE_MIN = 5 / 60;
  const res = (min: number | null, max: number | null) =>
    filters({ spatialResMin: min, spatialResMax: max });
  const resGroup = () => screen.getByRole("group", { name: "Spatial resolution" });
  const thumb = (name: string) => screen.getByRole("slider", { name });

  it("offers the preset chips, All, a unit and the range slider, in that order", () => {
    setup();
    const g = resGroup();
    const chip = within(g).getByRole("button", { name: "30 arc-sec" });
    const all = within(g).getByRole("checkbox", { name: "All" });
    const unit = within(g).getByRole("button", { name: "Degrees" });
    const finest = thumb("Finest resolution");
    const before = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(before(chip, all)).toBe(true);
    expect(before(all, unit)).toBe(true);
    expect(before(unit, finest)).toBe(true);
    expect(thumb("Coarsest resolution")).toBeTruthy();
    for (const label of ["30 arc-sec", "5 arc-min", "15 arc-min", "0.5°", "1°"]) {
      const c = screen.getByRole("button", { name: label });
      expect(c.className).toContain("font-mono");
      expect(c.className).toContain("rounded-full");
      expect(c.getAttribute("aria-pressed")).toBe("false");
    }
    expect(screen.queryByRole("button", { name: "0.25°" })).toBeNull();
  });

  it("shows finest and coarsest, with All ticked, while no range is set", () => {
    setup();
    expect((within(resGroup()).getByRole("checkbox", { name: "All" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("finest")).toBeTruthy();
    expect(screen.getByText("coarsest")).toBeTruthy();
    expect(thumb("Finest resolution").getAttribute("aria-valuenow")).toBe("0");
    expect(thumb("Coarsest resolution").getAttribute("aria-valuenow")).toBe("2");
  });

  it("clears the range when All is ticked, and does nothing when it is unticked with no range", () => {
    const { onChange } = setup();
    fireEvent.click(within(resGroup()).getByRole("checkbox", { name: "All" }));
    expect(onChange).not.toHaveBeenCalled();
    cleanup();

    const again = setup(res(0.1, 0.5));
    const all = within(resGroup()).getByRole("checkbox", { name: "All" }) as HTMLInputElement;
    expect(all.checked).toBe(false);
    fireEvent.click(all);
    expect(again.onChange).toHaveBeenCalledWith({ spatialResMin: null, spatialResMax: null });
  });

  it("names the three units, marks the chosen one pressed and starts in degrees", () => {
    setup();
    const pressed = (name: string) => screen.getByRole("button", { name }).getAttribute("aria-pressed");
    expect(pressed("Degrees")).toBe("true");
    expect(pressed("Arc-minutes")).toBe("false");
    expect(pressed("Arc-seconds")).toBe("false");
    expect(screen.getByRole("button", { name: "Arc-minutes" }).textContent).toBe("′");
    expect(screen.getByRole("button", { name: "Arc-seconds" }).textContent).toBe("″");
    expect(screen.getByRole("button", { name: "Arc-minutes" }).className).toContain("font-mono");
    expect(screen.getByRole("button", { name: "Arc-minutes" }).className).toContain("h-10");
    fireEvent.click(screen.getByRole("button", { name: "Arc-minutes" }));
    expect(pressed("Degrees")).toBe("false");
    expect(pressed("Arc-minutes")).toBe("true");
  });

  it("writes the range in the chosen unit and reports nothing when the unit changes", () => {
    const { onChange } = setup(res(FIVE_MIN, FIVE_MIN));
    const g = resGroup();
    // Min and max are the same value: both captions show it.
    expect(within(g).getAllByText("0.0833°")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Arc-minutes" }));
    expect(within(g).getAllByText("5.0′")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Arc-seconds" }));
    expect(within(g).getAllByText("300″")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Degrees" }));
    expect(within(g).getAllByText("0.0833°")).toHaveLength(2);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("formats the caption for a coarse range in each unit", () => {
    setup(res(0.5, 1));
    const g = resGroup();
    expect(within(g).getByText("0.50°")).toBeTruthy();
    expect(within(g).getByText("1.00°")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Arc-minutes" }));
    expect(within(g).getByText("30.0′")).toBeTruthy();
    expect(within(g).getByText("60.0′")).toBeTruthy();
  });

  it("moves a handle with the keyboard and reports the range in degrees", () => {
    const { onChange } = setup();
    fireEvent.keyDown(thumb("Finest resolution"), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith({ spatialResMin: 0.001, spatialResMax: 2 });
  });

  it("moves the coarsest handle with the keyboard too", () => {
    const { onChange } = setup(res(0.25, 1));
    // The slider moves the handle that has focus.
    fireEvent.focus(thumb("Coarsest resolution"));
    fireEvent.keyDown(thumb("Coarsest resolution"), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith({ spatialResMin: 0.25, spatialResMax: 0.999 });
  });

  it("clears the filter when both handles are back at the ends", () => {
    const { onChange } = setup(res(0.001, 2));
    fireEvent.keyDown(thumb("Finest resolution"), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith({ spatialResMin: null, spatialResMax: null });
  });

  it("puts a preset on both handles and lights only its chip", () => {
    setup(res(FIVE_MIN, FIVE_MIN));
    expect(Number(thumb("Finest resolution").getAttribute("aria-valuenow"))).toBeCloseTo(FIVE_MIN, 6);
    expect(Number(thumb("Coarsest resolution").getAttribute("aria-valuenow"))).toBeCloseTo(FIVE_MIN, 6);
    expect(screen.getByRole("button", { name: "5 arc-min" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "15 arc-min" }).getAttribute("aria-pressed")).toBe("false");
    expect((within(resGroup()).getByRole("checkbox", { name: "All" }) as HTMLInputElement).checked).toBe(false);
  });

  it("un-presses the chip as soon as a handle moves", () => {
    setup(res(0.5, 0.5));
    const chip = screen.getByRole("button", { name: "0.5°" });
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    fireEvent.focus(thumb("Coarsest resolution"));
    fireEvent.keyDown(thumb("Coarsest resolution"), { key: "ArrowRight" });
    expect(chip.getAttribute("aria-pressed")).toBe("false");
  });

  it("drops a moved handle's draft once the filter changes, and does not bring it back", () => {
    const ui = (state: CatalogueFilterState) => (
      <CatalogueSidebar filters={state} facets={FACETS} onChange={vi.fn()} onClearAll={vi.fn()} />
    );
    const { rerender } = render(ui(res(0.5, 0.5)));
    const chip = () => screen.getByRole("button", { name: "0.5°" });
    fireEvent.focus(thumb("Coarsest resolution"));
    fireEvent.keyDown(thumb("Coarsest resolution"), { key: "ArrowRight" });
    expect(chip().getAttribute("aria-pressed")).toBe("false");
    // The URL catches up with the keyboard step.
    rerender(ui(res(0.5, 0.501)));
    expect(Number(thumb("Coarsest resolution").getAttribute("aria-valuenow"))).toBeCloseTo(0.501, 6);
    // Reset puts the filter back where the draft was made: the chip is lit, not the old draft.
    rerender(ui(res(0.5, 0.5)));
    expect(chip().getAttribute("aria-pressed")).toBe("true");
    expect(Number(thumb("Coarsest resolution").getAttribute("aria-valuenow"))).toBeCloseTo(0.5, 6);
  });

  it("lights no chip for a range that is not a preset, and Reset clears it", () => {
    const { onClearAll } = setup(res(0.1, 0.4));
    const g = resGroup();
    for (const chip of ["30 arc-sec", "5 arc-min", "15 arc-min", "0.5°", "1°"]) {
      expect(within(g).getByRole("button", { name: chip }).getAttribute("aria-pressed")).toBe("false");
    }
    expect(within(g).getByText("0.10°")).toBeTruthy();
    expect(within(g).getByText("0.40°")).toBeTruthy();
    expect(group(/^Spatial resolution/).getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(onClearAll).toHaveBeenCalledTimes(1);
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
    expect(toggle.className).toContain("h-12");

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

describe("CatalogueSidebar region", () => {
  const BOX = { boxNorth: 45, boxSouth: 40, boxEast: -100, boxWest: -110 };
  const NO_BOX = { boxNorth: null, boxSouth: null, boxEast: null, boxWest: null };
  const open = () => fireEvent.click(group(/^Region/));
  const field = (name: string) => screen.getByLabelText(name) as HTMLInputElement;
  const type = (name: string, value: string) => fireEvent.change(field(name), { target: { value } });

  /** Holds the filter state as the page does, so a change comes back as props. */
  function Harness({
    initial,
    onChange,
  }: {
    initial: CatalogueFilterState;
    onChange: (updates: Partial<CatalogueFilterState>) => void;
  }) {
    const [state, setState] = useState(initial);
    return (
      <>
        <button type="button" onClick={() => setState(filters())}>
          reset from outside
        </button>
        <CatalogueSidebar
          filters={state}
          facets={FACETS}
          onChange={(updates) => {
            onChange(updates);
            setState((prev) => ({ ...prev, ...updates }));
          }}
          onClearAll={vi.fn()}
        />
      </>
    );
  }
  const setupBox = (initial: CatalogueFilterState = filters()) => {
    const onChange = vi.fn();
    render(<Harness initial={initial} onChange={onChange} />);
    return { onChange };
  };

  it("comes after Spatial resolution, folded until a box is set", () => {
    setup();
    const titles = screen
      .getAllByRole("button")
      .filter((b) => b.hasAttribute("aria-controls"))
      .map((b) => b.textContent ?? "");
    expect(titles.indexOf("Region")).toBe(titles.indexOf("Spatial resolution") + 1);
    expect(group(/^Region/).getAttribute("aria-expanded")).toBe("false");
    cleanup();
    setup(filters(BOX));
    expect(group(/^Region/).getAttribute("aria-expanded")).toBe("true");
  });

  it("offers North, South, West and East, empty, with the unit and the overlap rule said once", () => {
    setup();
    open();
    for (const name of ["North", "South", "West", "East"]) expect(field(name).value).toBe("");
    const g = screen.getByRole("group", { name: "Region" });
    expect(within(g).getByText(/Decimal degrees/).textContent).toMatch(/overlaps the box/);
    expect(within(g).queryByRole("button", { name: "Clear region" })).toBeNull();
  });

  it("shows the box from the URL state", () => {
    setup(filters({ ...BOX, boxWest: -110.5 }));
    expect(field("North").value).toBe("45");
    expect(field("South").value).toBe("40");
    expect(field("West").value).toBe("-110.5");
    expect(field("East").value).toBe("-100");
  });

  it("sets the filter only once all four are valid, then on every valid change", () => {
    const { onChange } = setupBox();
    open();
    type("North", "45");
    type("South", "40");
    type("West", "-110");
    expect(onChange).not.toHaveBeenCalled();
    type("East", "-100");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(BOX);
    type("East", "-95");
    expect(onChange).toHaveBeenLastCalledWith({ ...BOX, boxEast: -95 });
  });

  it("takes west above east as a box across the antimeridian", () => {
    const { onChange } = setupBox();
    open();
    type("North", "10");
    type("South", "-10");
    type("West", "170");
    type("East", "-170");
    expect(onChange).toHaveBeenLastCalledWith({
      boxNorth: 10,
      boxSouth: -10,
      boxEast: -170,
      boxWest: 170,
    });
    expect(screen.queryByText(/must/i)).toBeNull();
  });

  it("clears the filter when an edge stops being valid, and keeps what was typed", () => {
    const { onChange } = setupBox(filters(BOX));
    type("West", "-");
    expect(onChange).toHaveBeenLastCalledWith(NO_BOX);
    expect(field("West").value).toBe("-");
    expect(field("North").value).toBe("45");
    // the text on the way to a number is not an error while the field has focus
    fireEvent.focus(field("West"));
    expect(screen.queryByText("Enter a number")).toBeNull();
    type("West", "-1");
    expect(onChange).toHaveBeenLastCalledWith({ ...BOX, boxWest: -1 });
  });

  it("does not report anything while the box is only incomplete", () => {
    const { onChange } = setupBox(filters(BOX));
    type("North", "");
    expect(onChange).toHaveBeenLastCalledWith(NO_BOX);
    // clearing an edge twice over, or typing in an unset box, sends nothing more
    onChange.mockClear();
    type("South", "");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("says what is wrong with an edge, inline, once the field is left", () => {
    const { onChange } = setupBox();
    open();
    fireEvent.focus(field("North"));
    type("North", "95");
    fireEvent.blur(field("North"));
    expect(screen.getByText("Must be between -90 and 90")).toBeTruthy();
    expect(field("North").getAttribute("aria-invalid")).toBe("true");
    expect(field("North").getAttribute("aria-describedby")).toBe(
      screen.getByText("Must be between -90 and 90").id
    );
    type("East", "181");
    fireEvent.blur(field("East"));
    expect(screen.getByText("Must be between -180 and 180")).toBeTruthy();
    type("West", "abc");
    fireEvent.blur(field("West"));
    expect(screen.getByText("Enter a number")).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("refuses a south above the north, on South, and applies once it is fixed", () => {
    const { onChange } = setupBox(filters(BOX));
    type("South", "50");
    fireEvent.blur(field("South"));
    expect(screen.getByText("Must not be above North")).toBeTruthy();
    expect(onChange).toHaveBeenLastCalledWith(NO_BOX);
    type("South", "44");
    expect(screen.queryByText("Must not be above North")).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith({ ...BOX, boxSouth: 44 });
  });

  it("has a Clear region button that empties the fields and the filter", () => {
    const { onChange } = setupBox(filters(BOX));
    fireEvent.click(screen.getByRole("button", { name: "Clear region" }));
    expect(onChange).toHaveBeenLastCalledWith(NO_BOX);
    for (const name of ["North", "South", "West", "East"]) expect(field(name).value).toBe("");
  });

  it("follows a box that changes from outside (Reset, a chip, the back button)", () => {
    setupBox(filters(BOX));
    expect(field("North").value).toBe("45");
    fireEvent.click(screen.getByRole("button", { name: "reset from outside" }));
    for (const name of ["North", "South", "West", "East"]) expect(field(name).value).toBe("");
  });

  it("counts as one active filter, and Reset's state has no box", () => {
    setup(filters(BOX));
    expect(screen.getByRole("button", { name: /^Filters/ }).textContent).toContain("1");
    expect(clearedFilters(filters(BOX))).toMatchObject(NO_BOX);
  });
});
