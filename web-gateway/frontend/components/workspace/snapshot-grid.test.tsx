import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { SnapshotGrid } from "@/components/workspace/snapshot-grid";
import { fakeDataset } from "@/lib/workspace/fixtures";
import type { Dataset } from "@/lib/repository/types";

afterEach(cleanup);

const LONG_TITLE =
  "WBM v1.0.0 Global_tracking simulation for 'Water balance model (WBM) v.1.0.0: a scalable gridded global hydrologic model with water-tracking functionality': [Global] [2000-2009]";

function snapshot(id: string, name: string, over: { version?: string; end?: string; tags?: Dataset["about"]["tags"] } = {}) {
  const base = fakeDataset();
  return fakeDataset({
    id,
    about: { ...base.about, name, tags: over.tags ?? ["publication"] },
    uses: { ...base.uses, container: { ...base.uses.container, version: over.version ?? "1.0.0" } },
    simulation: {
      ...base.simulation,
      resolution: { value: 5, unit: "arc-minute" },
      temporalCoverage: { start: "2000-01-01", end: over.end ?? "2009-12-31" },
    },
  });
}
const GLOBAL = snapshot("global", LONG_TITLE);
const TUTORIAL = snapshot("tutorial", "WBM v2.0.0 simulation as tutorial: [CONUS] [2000-2001]", {
  version: "2.0.0",
  end: "2001-12-31",
  tags: ["tutorial"],
});
const WYOMING = snapshot("wyoming", "WBM v1.0.0 Wyoming_tracking simulation");

function grid(over: Partial<React.ComponentProps<typeof SnapshotGrid>> = {}) {
  const onSelect = vi.fn();
  const onDetails = vi.fn();
  const view = render(
    <SnapshotGrid
      datasets={[GLOBAL, TUTORIAL]}
      usedIds={new Set()}
      onSelect={onSelect}
      onDetails={onDetails}
      pendingId={null}
      disabled={false}
      {...over}
    />
  );
  return { ...view, onSelect, onDetails };
}
const cards = () => within(screen.getByRole("list", { name: "Model snapshots" })).getAllByRole("listitem");

describe("a card", () => {
  it("leads with the short name, then one mono line, then the official title, then the tag", () => {
    grid();
    const [first, second] = cards();
    expect(within(first).getByRole("heading", { level: 3 }).textContent).toBe("WBM 1.0.0 · 2000–2009");
    expect(within(second).getByRole("heading", { level: 3 }).textContent).toBe("WBM 2.0.0 · 2000–2001");
    expect(first.textContent).toContain("5 arc-min · Published");
    expect(first.textContent).toContain("Publication");
    expect(second.textContent).toContain("Tutorial");
  });

  it("clamps the official title to two muted lines and keeps the whole of it in title", () => {
    grid();
    const title = within(cards()[0]).getByText(LONG_TITLE);
    expect(title.className).toContain("line-clamp-2");
    expect(title.className).toContain("text-muted-foreground");
    expect(title.getAttribute("title")).toBe(LONG_TITLE);
  });

  it("draws the bounding box as a map thumbnail, with the repository's Global or Regional label", () => {
    grid();
    expect(within(cards()[0]).getByRole("img", { name: /^Coverage: north 10°/ })).toBeTruthy();
    expect(within(cards()[0]).getByText("Regional")).toBeTruthy();
  });

  it("is selected by its name, the one control, which the official title describes", () => {
    const { onSelect } = grid();
    const select = within(cards()[1]).getByRole("button", { name: "WBM 2.0.0 · 2000–2001" });
    expect(select.className).toContain("after:absolute");
    expect(select.className).toContain("after:inset-0");
    const describedBy = select.getAttribute("aria-describedby") as string;
    expect(document.getElementById(describedBy)?.textContent).toBe("WBM v2.0.0 simulation as tutorial: [CONUS] [2000-2001]");
    fireEvent.click(select);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(TUTORIAL);
  });

  it("opens Details without selecting", () => {
    const { onSelect, onDetails } = grid();
    fireEvent.click(screen.getByRole("button", { name: `Details: ${LONG_TITLE}` }));
    expect(onDetails).toHaveBeenCalledWith(GLOBAL);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("keeps Details above the card's click layer and 40 px tall on a phone", () => {
    grid();
    const details = screen.getByRole("button", { name: `Details: ${LONG_TITLE}` });
    expect(details.className).toContain("relative");
    expect(details.className).toContain("z-10");
    expect(details.className).toContain("h-10");
  });

  it("is a grid of one column, then two, then three", () => {
    grid();
    const list = screen.getByRole("list", { name: "Model snapshots" });
    expect(list.className).toContain("grid");
    expect(list.className).toContain("sm:grid-cols-2");
    expect(list.className).toContain("lg:grid-cols-3");
    expect(list.className).not.toMatch(/(^| )grid-cols-/);
  });
});

describe("the snapshots the user has used", () => {
  it("come first, in the order they were given, and are marked", () => {
    grid({ datasets: [GLOBAL, TUTORIAL, WYOMING], usedIds: new Set(["wyoming", "tutorial"]) });
    const headings = cards().map((card) => within(card).getByRole("heading", { level: 3 }).textContent);
    expect(headings).toEqual(["WBM 2.0.0 · 2000–2001", "WBM 1.0.0 · 2000–2009", "WBM 1.0.0 · 2000–2009"]);
    expect(within(cards()[0]).getByText("Used before")).toBeTruthy();
    expect(within(cards()[1]).getByText("Used before")).toBeTruthy();
    expect(within(cards()[2]).queryByText("Used before")).toBeNull();
    // The one that was not used is the first given: Global.
    expect(within(cards()[2]).getByText(LONG_TITLE)).toBeTruthy();
  });

  it("leave the order alone when there are none", () => {
    grid({ datasets: [GLOBAL, TUTORIAL, WYOMING] });
    expect(screen.queryByText("Used before")).toBeNull();
    expect(cards().map((card) => within(card).getAllByRole("button")[0].textContent)).toEqual([
      "WBM 1.0.0 · 2000–2009",
      "WBM 2.0.0 · 2000–2001",
      "WBM 1.0.0 · 2000–2009",
    ]);
  });
});

describe("while a draft is being made", () => {
  it("covers the clicked card with a message, and turns every card off", () => {
    grid({ pendingId: "global", disabled: true });
    const [first, second] = cards();
    expect(within(first).getByRole("status").textContent).toContain("Creating your draft");
    expect(within(first).getByRole("button", { name: "WBM 1.0.0 · 2000–2009" }).getAttribute("aria-busy")).toBe("true");
    for (const button of screen.getAllByRole("button", { name: /^WBM / })) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    expect(within(second).queryByRole("status")).toBeNull();
    expect(second.querySelector("[data-slot=card]")?.className).toContain("pointer-events-none");
    expect(first.querySelector("[data-slot=card]")?.className).not.toContain("pointer-events-none");
  });
});

describe("with nothing to show", () => {
  it("says so, and offers the way out it is given", () => {
    grid({ datasets: [], emptyAction: <button type="button">Reset</button> });
    expect(screen.getByRole("heading", { name: "No model snapshots found" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset" })).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });
});
