import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
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

    expect(screen.getAllByText("Fake Snapshot").length).toBeGreaterThan(0);
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

    // One per layout: the phone card and the table row (CSS hides one).
    expect(screen.getAllByRole("button", { name: /select/i })).toHaveLength(2);
  });

  it("prints the published date as a <time> element that carries the ISO value", () => {
    const dataset = fakeDataset();
    const { container } = render(<DatasetTable datasets={[dataset]} modelInputIds={null} />);

    const times = container.querySelectorAll("time");
    expect(times.length).toBeGreaterThan(0);
    for (const time of times) expect(time.getAttribute("dateTime")).toBe(dataset.generatedAt);
  });

  it("is a real table from sm up: a table with a header row and one row per dataset", () => {
    const datasets = [fakeDataset(), fakeDataset({ id: "other" })];
    const { container } = render(
      <DatasetTable
        datasets={datasets}
        modelInputIds={null}
        renderAction={() => <button type="button">Select</button>}
      />
    );

    const table = screen.getByRole("table", { name: "Datasets" });
    // Shown from sm up only; never `display: block`, which would drop its roles.
    expect(table.className).toContain("hidden");
    expect(table.className).toContain("sm:table");
    expect(table.className).not.toMatch(/(^|\s)block(\s|$)/);
    expect(container.querySelector("tbody tr")?.className).not.toContain("flex");

    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(1 + datasets.length);
    expect(within(rows[0]).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Name",
      "Period",
      "Resolution",
      "WBM Version",
      "Model Input",
      "Published",
      "Action",
    ]);
    const cells = within(rows[1]).getAllByRole("cell");
    expect(cells[0].textContent).toContain("Fake Snapshot");
    expect(within(cells[cells.length - 1]).getByRole("button", { name: /select/i })).toBeTruthy();
  });

  it("is a list of cards below sm: one listitem per dataset with its name, period and action", () => {
    const dataset = fakeDataset();
    const { start, end } = dataset.simulation.temporalCoverage;
    const datasets = [dataset, fakeDataset({ id: "other" })];
    render(
      <DatasetTable
        datasets={datasets}
        modelInputIds={null}
        renderAction={() => <button type="button">Select</button>}
      />
    );

    const list = screen.getByRole("list", { name: "Datasets" });
    // Hidden from sm up with display:none, so exactly one copy is exposed.
    expect(list.className).toContain("sm:hidden");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(datasets.length);
    expect(within(items[0]).getByText("Fake Snapshot")).toBeTruthy();
    expect(items[0].textContent).toContain(`${start} – ${end}`);
    expect(items[0].textContent).toContain(dataset.uses.container.version);
    expect(items[0].textContent).toContain("Published");
    expect(within(items[0]).getByText("Test")).toBeTruthy(); // the tag chip
    expect(items[0].textContent).toContain("Checking…");
    expect(within(items[0]).getByRole("button", { name: /select/i })).toBeTruthy();
    // The phone layout is not a table: no table roles inside the list.
    expect(within(list).queryByRole("row")).toBeNull();
  });

  it("keeps the link and the model-input states in both layouts", () => {
    const dataset = fakeDataset();
    const { rerender } = render(
      <DatasetTable datasets={[dataset]} modelInputIds={new Set([dataset.uses.modelInput.id])} />
    );
    const links = screen.getAllByRole("link", { name: "Fake Snapshot" });
    expect(links).toHaveLength(2);
    for (const link of links) expect(link.getAttribute("href")).toBe(`/repository/${dataset.id}`);
    expect(screen.getAllByText("Present")).toHaveLength(2);

    rerender(<DatasetTable datasets={[dataset]} modelInputIds={new Set()} />);
    expect(screen.getAllByText("Missing")).toHaveLength(2);

    rerender(<DatasetTable datasets={[dataset]} modelInputIds={null} />);
    expect(screen.getAllByText("Checking…")).toHaveLength(2);
  });

  it("calls onNameClick from the name button in either layout", () => {
    const dataset = fakeDataset();
    const onNameClick = vi.fn();
    render(<DatasetTable datasets={[dataset]} modelInputIds={null} onNameClick={onNameClick} />);
    const buttons = screen.getAllByRole("button", { name: "Fake Snapshot" });
    expect(buttons).toHaveLength(2);
    for (const button of buttons) fireEvent.click(button);
    expect(onNameClick).toHaveBeenCalledTimes(2);
    expect(onNameClick).toHaveBeenCalledWith(dataset);
  });

  it("colours the chips with tokens, not raw palette classes", () => {
    const { container } = render(<DatasetTable datasets={[fakeDataset()]} modelInputIds={new Set()} />);
    expect(container.innerHTML).not.toMatch(/#006994|emerald|amber|slate-/);
  });
});
