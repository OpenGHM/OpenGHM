import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CatalogueToolbar } from "./catalogue-toolbar";
import type { CatalogueFilterState } from "@/lib/repository/types";
import { filters } from "./catalogue.fixtures";

afterEach(cleanup);

function setup(state: CatalogueFilterState = filters()) {
  const onChange = vi.fn();
  render(
    <div>
      <CatalogueToolbar filters={state} onChange={onChange} />
      <input aria-label="Other field" />
      <textarea aria-label="Notes" />
      <button type="button">Other button</button>
    </div>
  );
  return { onChange };
}

const search = () => screen.getByRole("searchbox", { name: "Search the repository" }) as HTMLInputElement;

describe("CatalogueToolbar search", () => {
  it("reports typing and shows the / hint while empty", () => {
    const { onChange } = setup();
    fireEvent.change(search(), { target: { value: "gpcc" } });
    expect(onChange).toHaveBeenCalledWith({ searchQuery: "gpcc" });
    expect(document.querySelector("kbd")?.textContent).toBe("/");
  });

  it("swaps the hint for a Clear search button once there is text", () => {
    const { onChange } = setup(filters({ searchQuery: "gpcc" }));
    expect(document.querySelector("kbd")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(onChange).toHaveBeenCalledWith({ searchQuery: "" });
    expect(document.activeElement).toBe(search());
  });

  it("takes focus on / from anywhere outside a text field", () => {
    setup();
    screen.getByRole("button", { name: "Other button" }).focus();
    const event = new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    expect(document.activeElement).toBe(search());
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves / alone while typing in a text field", () => {
    setup();
    for (const name of ["Other field", "Notes"]) {
      const field = screen.getByLabelText(name);
      field.focus();
      const event = new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true });
      field.dispatchEvent(event);
      expect(document.activeElement).toBe(field);
      expect(event.defaultPrevented).toBe(false);
    }
  });

  it("leaves a modified / alone", () => {
    setup();
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "/", ctrlKey: true, bubbles: true }));
    expect(document.activeElement).not.toBe(search());
  });

  it("lets go of the box on Escape", () => {
    setup();
    search().focus();
    fireEvent.keyDown(search(), { key: "Escape" });
    expect(document.activeElement).toBe(document.body);
  });
});

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
    const { onChange } = setup(filters({ page: 3, category: ["hydrology"] }));
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
