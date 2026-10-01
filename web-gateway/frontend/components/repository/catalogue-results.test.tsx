import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CatalogueResults } from "./catalogue-results";
import { EMPTY_CATALOGUE } from "@/lib/repository/catalogue";
import type { CatalogueFilterState, CatalogueResponse } from "@/lib/repository/types";
import { FACETS, filters, modelInputItem, response, snapshotItem } from "./catalogue.fixtures";

afterEach(cleanup);

function setup(
  result: CatalogueResponse,
  state: CatalogueFilterState = filters(),
  flags: { isLoading?: boolean; error?: boolean } = {}
) {
  const onChange = vi.fn();
  const onClearAll = vi.fn();
  const onRetry = vi.fn();
  const onToggleKeyword = vi.fn();
  const view = render(
    <CatalogueResults
      result={result}
      filters={state}
      facets={FACETS}
      isLoading={flags.isLoading ?? false}
      error={flags.error ?? false}
      onChange={onChange}
      onClearAll={onClearAll}
      onRetry={onRetry}
      onToggleKeyword={onToggleKeyword}
    />
  );
  return { ...view, onChange, onClearAll, onRetry, onToggleKeyword };
}

describe("CatalogueResults header", () => {
  it("shows the title and the count in a polite live region", () => {
    setup(response([snapshotItem(), modelInputItem()], { totalCount: 12 }));
    expect(screen.getByRole("heading", { level: 1, name: "Data Repository" })).toBeTruthy();
    const count = screen.getByText(/12 results found/);
    expect(count.getAttribute("aria-live")).toBe("polite");
  });

  it("says result in the singular and names the search", () => {
    setup(response([snapshotItem()], { totalCount: 1 }), filters({ searchQuery: "storage" }));
    const count = screen.getByText(/1 result found/);
    expect(count.textContent).toBe("1 result found for ‘storage’");
  });

  it("offers the four sorts and reports a change", () => {
    const { onChange } = setup(response([snapshotItem()]), filters({ sortBy: "newest" }));
    const sort = screen.getByLabelText("Sort by") as HTMLSelectElement;
    expect(sort.value).toBe("newest");
    expect([...sort.options].map((o) => o.value)).toEqual([
      "relevance",
      "newest",
      "title-az",
      "title-za",
    ]);
    fireEvent.change(sort, { target: { value: "title-az" } });
    expect(onChange).toHaveBeenCalledWith({ sortBy: "title-az" });
  });

  it("shows the active-filter chips only when a filter is on", () => {
    const { rerender } = setup(response([snapshotItem()]));
    expect(screen.queryByRole("list", { name: "Active filters" })).toBeNull();
    rerender(
      <CatalogueResults
        result={response([snapshotItem()])}
        filters={filters({ category: ["hydrology"] })}
        facets={FACETS}
        isLoading={false}
        error={false}
        onChange={vi.fn()}
        onClearAll={vi.fn()}
        onRetry={vi.fn()}
        onToggleKeyword={vi.fn()}
      />
    );
    expect(screen.getByRole("list", { name: "Active filters" })).toBeTruthy();
  });
});

describe("CatalogueResults list", () => {
  it("lists snapshots and model inputs together as cards", () => {
    setup(response([snapshotItem(), modelInputItem()]));
    expect(screen.getByRole("link", { name: "Global Storage Run" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ancillary Data v1" })).toBeTruthy();
    expect(screen.getByText("Model Snapshot")).toBeTruthy();
    expect(screen.getByText("Model Input")).toBeTruthy();
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("has no commit control: the repository browses, it does not select", () => {
    setup(response([snapshotItem()]));
    expect(screen.queryByRole("button", { name: /select/i })).toBeNull();
  });

  it("pages through the results and goes back to the top of the list", () => {
    const scroll = vi.fn();
    const { onChange } = setup(
      response([snapshotItem()], { totalCount: 25, totalPages: 3 }),
      filters({ page: 2 })
    );
    document.getElementById("catalogue-results")!.scrollIntoView = scroll;
    expect(screen.getByRole("button", { name: "Page 2" }).getAttribute("aria-current")).toBe("page");
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(onChange).toHaveBeenCalledWith({ page: 3 });
    expect(scroll).toHaveBeenCalled();
  });
});

describe("CatalogueResults keyword chips", () => {
  it("passes the keyword filter to each card and reports a chip press, then keeps focus on the page", () => {
    const { onToggleKeyword } = setup(
      response([snapshotItem(), modelInputItem()]),
      filters({ keyword: ["storage"] })
    );
    // "storage" is a snapshot keyword, "network" a model input's.
    expect(
      screen.getByRole("button", { name: "Filter by keyword storage" }).getAttribute("aria-pressed")
    ).toBe("true");
    const network = screen.getByRole("button", { name: "Filter by keyword network" });
    expect(network.getAttribute("aria-pressed")).toBe("false");
    network.focus();
    fireEvent.click(network);
    expect(onToggleKeyword).toHaveBeenCalledWith("network");
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1 }));
  });
});

describe("CatalogueResults states", () => {
  it("shows skeleton cards while loading, announces it, and hides the pagination", () => {
    const { container } = setup(
      response([snapshotItem()], { totalPages: 3 }),
      filters(),
      { isLoading: true }
    );
    expect(container.querySelectorAll('[data-slot="card"][aria-hidden="true"]')).toHaveLength(3);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.getByText("Loading results")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Pagination" })).toBeNull();
    expect(container.querySelector(".motion-safe\\:animate-pulse")).not.toBeNull();
  });

  it("shows a dashed empty card with Clear filters when filters leave nothing", () => {
    const { container, onClearAll } = setup(
      { ...EMPTY_CATALOGUE, facets: FACETS },
      filters({ category: ["hydrology"] })
    );
    expect(screen.getByText("No results match these filters")).toBeTruthy();
    expect(container.querySelector(".border-dashed")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(onClearAll).toHaveBeenCalled();
    expect(screen.getByText(/0 results found/)).toBeTruthy();
  });

  it("says plainly when nothing has been published, without a Clear filters button", () => {
    setup({ ...EMPTY_CATALOGUE, facets: FACETS });
    expect(screen.getByText("Nothing has been published yet")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
  });

  it("shows an inline error with Retry, and not the empty card", () => {
    const { onRetry } = setup(EMPTY_CATALOGUE, filters(), { error: true });
    const alert = screen.getByRole("alert");
    expect(alert.className).toContain("destructive");
    expect(alert.textContent).toContain("could not be loaded");
    expect(screen.queryByText("No results match these filters")).toBeNull();
    expect(screen.queryByText("Nothing has been published yet")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
