import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DatasetTable } from "./dataset-table";
import { fakeDataset } from "@/lib/workspace/fixtures";

/**
 * `DatasetTable`'s own contract: no `renderAction` prop renders no action
 * column at all, and a `renderAction` prop renders whatever it returns.
 * This does NOT prove either real caller uses it correctly — that `/repository`
 * never passes one is covered separately, by
 * `repository-results.test.tsx` (sabotage-checked: adding `renderAction`
 * to `repository-results.tsx` fails that test, not this one).
 */
describe("DatasetTable", () => {
  it("renders no commit control when renderAction is absent", () => {
    render(<DatasetTable datasets={[fakeDataset()]} modelInputIds={null} />);

    expect(screen.getByText("Fake Snapshot")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /select/i })).toBeNull();
  });

  it("renders the passed-in commit control when renderAction is given", () => {
    render(
      <DatasetTable
        datasets={[fakeDataset()]}
        modelInputIds={null}
        renderAction={() => <button type="button">Select</button>}
      />
    );

    expect(screen.getByRole("button", { name: /select/i })).toBeTruthy();
  });
});
