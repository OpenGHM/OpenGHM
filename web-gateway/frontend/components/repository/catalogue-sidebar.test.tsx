import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CatalogueSidebar } from "./catalogue-sidebar";
import { EMPTY_CATALOGUE_FACETS } from "@/lib/repository/catalogue";
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
      .filter((t) => /^(Type|Category|Output variable|Forcing data|Temporal coverage|Spatial resolution|Model version|Active processes|Creator|License)/.test(t))
      .map((t) => t.replace(/\d+ selected.*$/, ""));
    expect(titles).toEqual([
      "Type",
      "Category",
      "Output variable",
      "Forcing data",
      "Temporal coverage",
      "Spatial resolution",
      "Model version",
      "Creator",
      "License",
    ]);
  });

  it("opens Type, Category, Temporal coverage and Spatial resolution and folds the rest", () => {
    setup();
    for (const name of [/^Type/, /^Category/, /^Temporal coverage/, /^Spatial resolution/]) {
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
    expect(screen.queryByRole("button", { name: /^Category/ })).toBeNull();
    expect(group(/^Type/)).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Model Snapshot" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Model Input" })).toBeTruthy();
  });

  it("shows the label with its count in parentheses", () => {
    setup();
    expect(screen.getByRole("checkbox", { name: "Model Snapshot (2)" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "hydrology (2)" })).toBeTruthy();
  });

  it("humanises forcing roles", () => {
    setup();
    fireEvent.click(group(/^Forcing data/));
    expect(screen.getByRole("checkbox", { name: "Wind (u) (2)" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Precipitation (3)" })).toBeTruthy();
  });

  it("shows how many values are selected on a group", () => {
    setup(filters({ category: ["hydrology", "ancillary"] }));
    expect(group(/^Category/).textContent).toContain("2 selected");
  });
});

describe("CatalogueSidebar checkboxes", () => {
  it("reports a ticked box as the facet's new selection", () => {
    const { onChange } = setup(filters({ category: ["ancillary"] }));
    fireEvent.click(screen.getByRole("checkbox", { name: "hydrology (2)" }));
    expect(onChange).toHaveBeenCalledWith({ category: ["ancillary", "hydrology"] });
  });

  it("reports an unticked box without the value", () => {
    const { onChange } = setup(filters({ type: ["snapshot", "model-input"] }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Model Snapshot (2)" }));
    expect(onChange).toHaveBeenCalledWith({ type: ["model-input"] });
  });

  it("keeps a selected value the facets no longer list, so it can be unticked", () => {
    const { onChange } = setup(filters({ category: ["gone"] }));
    fireEvent.click(screen.getByRole("checkbox", { name: "gone (0)" }));
    expect(onChange).toHaveBeenCalledWith({ category: [] });
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

describe("CatalogueSidebar Clear all", () => {
  it("is absent when nothing is selected", () => {
    setup();
    expect(screen.queryByRole("button", { name: "Clear all" })).toBeNull();
  });

  it.each([
    ["a facet value", filters({ license: ["CC-BY-4.0"] })],
    ["a year", filters({ yearStart: 2000 })],
    ["a resolution", filters({ spatialResMax: 0.5 })],
    ["a search", filters({ searchQuery: "storage" })],
  ])("appears for %s and clears when pressed", (_name, state) => {
    const { onClearAll } = setup(state);
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });
});

describe("CatalogueSidebar search", () => {
  it("reports typing", () => {
    const { onChange } = setup();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search" }), {
      target: { value: "gpcc" },
    });
    expect(onChange).toHaveBeenCalledWith({ searchQuery: "gpcc" });
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
  it("applies a preset as an exact resolution and lifts it when pressed again", () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: "0.5°" }));
    expect(onChange).toHaveBeenCalledWith({ spatialResMin: 0.5, spatialResMax: 0.5 });
  });

  it("marks the active preset as pressed and removes it on a second press", () => {
    const { onChange } = setup(filters({ spatialResMin: 0.5, spatialResMax: 0.5 }));
    const preset = screen.getByRole("button", { name: "0.5°" });
    expect(preset.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(preset);
    expect(onChange).toHaveBeenCalledWith({ spatialResMin: null, spatialResMax: null });
  });

  it("switches the unit", () => {
    setup();
    const arcmin = screen.getByRole("button", { name: "Arc-minutes" });
    expect(arcmin.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(arcmin);
    expect(arcmin.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("CatalogueSidebar on a phone", () => {
  it("folds the filters behind a Filters button that says how many are active", () => {
    setup(filters({ category: ["hydrology"], yearStart: 2000 }));
    const toggle = screen.getByRole("button", { name: /^Filters/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toContain("2");
    expect(toggle.className).toContain("lg:hidden");
    expect(toggle.className).toContain("h-10");

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
    const label = screen.getByRole("checkbox", { name: "hydrology (2)" }).closest("label");
    expect(label?.className).toContain("min-h-10");
  });
});
