import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/workspace/new/pick",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/repository/actions", () => ({
  fetchDatasets: vi.fn(),
  fetchModelInputIds: vi.fn(() => new Promise(() => {})),
}));

import { SnapshotPicker } from "@/components/workspace/snapshot-picker";
import { fakeDataset } from "@/lib/workspace/fixtures";
import type { FilterState } from "@/lib/repository/types";

// The filter sliders read ResizeObserver, which jsdom does not have.
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(cleanup);

const FILTERS: FilterState = {
  searchQuery: "",
  temporalCoverageStart: null,
  temporalCoverageEnd: null,
  spatialResMin: null,
  spatialResMax: null,
  sortBy: "relevance",
  page: 1,
};

function renderPicker() {
  return render(
    <SnapshotPicker
      initialFilters={FILTERS}
      initialData={{ items: [fakeDataset()], totalCount: 1, totalPages: 1, page: 1 }}
      initialModelInputIds={new Set()}
      onSelect={vi.fn()}
    />
  );
}

describe("the snapshot picker on a phone", () => {
  it("stacks the filters above the results below lg", () => {
    const { container } = renderPicker();
    const layout = container.firstElementChild;
    expect(layout?.className).toContain("flex-col");
    expect(layout?.className).toContain("lg:flex-row");
  });

  it("makes Select a full-width, 40 px button below sm", () => {
    renderPicker();
    const select = screen.getByRole("button", { name: /select/i });
    expect(select.className).toContain("w-full");
    expect(select.className).toContain("h-10");
    expect(select.className).toContain("sm:w-auto");
  });
});
