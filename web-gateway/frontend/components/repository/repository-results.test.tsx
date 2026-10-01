import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RepositoryResults } from "./repository-results";
import { fakeDataset } from "@/lib/workspace/fixtures";

/**
 * The acceptance criterion this guards: "the commit control does not
 * render on `/repository`." `RepositoryResults` is what `/repository`
 * actually renders (via `RepositoryClient`), and it calls `DatasetTable`
 * without `renderAction` — this asserts that composition, not just
 * `DatasetTable`'s own contract (`dataset-table.test.tsx` covers that
 * separately).
 *
 * Sabotage-checked: adding `renderAction={() => <button
 * type="button">Select</button>}` to the `<DatasetTable ...>` call in
 * `repository-results.tsx` makes this test fail (see review.md for the
 * pasted failing/passing output) — a plain "renders the list" test would
 * not have caught that regression, since `renderAction` is optional and
 * `tsc` doesn't require it either way.
 *
 * `totalPages={1}` so `Pagination` renders nothing — the only buttons in
 * a passing render are none at all, which keeps the assertion simple
 * (zero buttons) rather than coupled to a specific label.
 */
describe("RepositoryResults", () => {
  it("renders no buttons in browse mode — no commit control on /repository", () => {
    render(
      <RepositoryResults
        datasets={[fakeDataset()]}
        modelInputIds={null}
        totalCount={1}
        sortBy="relevance"
        onSortChange={() => {}}
        page={1}
        totalPages={1}
        onPageChange={() => {}}
      />
    );

    expect(screen.getAllByText("Fake Snapshot").length).toBeGreaterThan(0);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
