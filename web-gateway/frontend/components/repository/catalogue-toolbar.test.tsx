import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CatalogueToolbar } from "./catalogue-toolbar";
import type { CatalogueFilterState } from "@/lib/repository/types";
import { filters } from "./catalogue.fixtures";

afterEach(cleanup);

function setup(state: CatalogueFilterState = filters()) {
  const onChange = vi.fn();
  render(<CatalogueToolbar filters={state} onChange={onChange} />);
  return { onChange };
}

describe("CatalogueToolbar sort", () => {
  it("offers the five sorts and reports a change", () => {
    const { onChange } = setup(filters({ sortBy: "newest" }));
    const sort = screen.getByLabelText("Sort") as HTMLSelectElement;
    expect(sort.value).toBe("newest");
    expect([...sort.options].map((o) => [o.value, o.textContent])).toEqual([
      ["relevance", "Relevance"],
      ["newest", "Newest"],
      ["title-az", "Title A–Z"],
      ["title-za", "Title Z–A"],
      ["coverage-start", "Coverage start"],
    ]);
    fireEvent.change(sort, { target: { value: "coverage-start" } });
    expect(onChange).toHaveBeenCalledWith({ sortBy: "coverage-start" });
  });
});

describe("CatalogueToolbar view switch", () => {
  it("marks the current view as pressed", () => {
    setup(filters({ view: "grid" }));
    expect(screen.getByRole("button", { name: "Grid" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "List" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("reports only the view when switched, so the page and the filters stay", () => {
    const { onChange } = setup(filters({ page: 3, tag: ["publication"] }));
    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ view: "grid" });
  });

  it("gives every control a 40 px touch target", () => {
    setup();
    for (const name of ["List", "Grid"]) {
      expect(screen.getByRole("button", { name }).className).toContain("h-10");
    }
    expect((screen.getByLabelText("Sort") as HTMLElement).className).toContain("h-10");
  });
});
