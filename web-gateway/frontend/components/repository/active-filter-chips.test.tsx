import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ActiveFilterChips } from "./active-filter-chips";
import { FACETS, filters } from "./catalogue.fixtures";
import type { CatalogueFilterState } from "@/lib/repository/types";

afterEach(cleanup);

function setup(state: CatalogueFilterState) {
  const onChange = vi.fn();
  const onClearAll = vi.fn();
  const { container } = render(
    <ActiveFilterChips filters={state} facets={FACETS} onChange={onChange} onClearAll={onClearAll} />
  );
  return { container, onChange, onClearAll };
}

describe("ActiveFilterChips", () => {
  it("renders nothing when no filter is on", () => {
    const { container } = setup(filters());
    expect(container.firstChild).toBeNull();
  });

  it("gives each chip an accessible remove button that takes off just that value", () => {
    const { onChange } = setup(filters({ output: ["discharge", "runoff"], license: ["CC-BY-4.0"] }));
    const remove = screen.getByRole("button", { name: "Remove filter: Output: Discharge" });
    fireEvent.click(remove);
    expect(onChange).toHaveBeenCalledWith({ output: ["runoff"] });
    fireEvent.click(screen.getByRole("button", { name: "Remove filter: License: CC-BY-4.0" }));
    expect(onChange).toHaveBeenLastCalledWith({ license: [] });
  });

  it("has a chip each for the years, the resolution and the search", () => {
    const { onChange } = setup(
      filters({ yearStart: 2000, yearEnd: 2009, spatialResMin: 0.5, spatialResMax: 0.5, searchQuery: "gpcc" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove filter: Years: 2000 – 2009" }));
    expect(onChange).toHaveBeenLastCalledWith({ yearStart: null, yearEnd: null });
    fireEvent.click(screen.getByRole("button", { name: "Remove filter: Resolution: 0.5°" }));
    expect(onChange).toHaveBeenLastCalledWith({ spatialResMin: null, spatialResMax: null });
    fireEvent.click(screen.getByRole("button", { name: "Remove filter: Search: ‘gpcc’" }));
    expect(onChange).toHaveBeenLastCalledWith({ searchQuery: "" });
  });

  it("labels a keyword chip Keyword: X and removes just that keyword", () => {
    const { onChange } = setup(filters({ keyword: ["storage", "soils"] }));
    fireEvent.click(screen.getByRole("button", { name: "Remove filter: Keyword: storage" }));
    expect(onChange).toHaveBeenCalledWith({ keyword: ["soils"] });
    expect(screen.getByRole("button", { name: "Remove filter: Keyword: soils" })).toBeTruthy();
  });

  it("labels a tag chip Tag: Name with the readable name and removes just that tag", () => {
    const { onChange } = setup(filters({ tag: ["ancillary-data", "river-network"] }));
    expect(screen.getByRole("button", { name: "Remove filter: Tag: River network" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove filter: Tag: Ancillary data" }));
    expect(onChange).toHaveBeenCalledWith({ tag: ["river-network"] });
  });

  it("clears everything from Clear all", () => {
    const { onClearAll } = setup(filters({ tag: ["publication"] }));
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it("makes every chip a 40 px target on a phone", () => {
    setup(filters({ tag: ["publication"] }));
    expect(screen.getByRole("button", { name: /Remove filter/ }).className).toContain("h-10");
  });
});
