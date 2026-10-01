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

  it("prints the published date as a <time> element that carries the ISO value", () => {
    const dataset = fakeDataset();
    const { container } = render(<DatasetTable datasets={[dataset]} modelInputIds={null} />);

    const time = container.querySelector("time");
    expect(time).not.toBeNull();
    expect(time?.getAttribute("dateTime")).toBe(dataset.generatedAt);
  });

  it("stacks each row below sm: the table parts are blocks, the name and action take a line", () => {
    const { container } = render(
      <DatasetTable
        datasets={[fakeDataset()]}
        modelInputIds={null}
        renderAction={() => <button type="button">Select</button>}
      />
    );

    expect(container.querySelector("table")?.className).toContain("block");
    expect(container.querySelector("table")?.className).toContain("sm:table");
    expect(container.querySelector("thead")?.className).toContain("hidden");
    const row = container.querySelector("tbody tr");
    expect(row?.className).toContain("flex-wrap");
    expect(row?.className).toContain("sm:table-row");
    const cells = Array.from(row?.querySelectorAll("td") ?? []);
    // Name first, action last, each on a line of its own on a phone.
    expect(cells[0].className).toContain("basis-full");
    expect(cells[cells.length - 1].className).toContain("basis-full");
    // The date carries its label on a phone, where the column header is hidden.
    expect(row?.textContent).toContain("Published");
  });

  it("colours the chips with tokens, not raw palette classes", () => {
    const { container } = render(<DatasetTable datasets={[fakeDataset()]} modelInputIds={new Set()} />);
    expect(container.innerHTML).not.toMatch(/#006994|emerald|amber|slate-/);
  });
});
