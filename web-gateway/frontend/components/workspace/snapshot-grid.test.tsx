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
      usedFirst
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
const headings = () => cards().map((card) => within(card).getByRole("heading", { level: 3 }).textContent);

describe("a card", () => {
  it("is named by the snapshot's title, whole, and by nothing made up from its fields", () => {
    grid();
    expect(headings()).toEqual([LONG_TITLE, "WBM v2.0.0 simulation as tutorial: [CONUS] [2000-2001]"]);
    for (const card of cards()) expect(within(card).getByRole("heading", { level: 3 }).textContent).not.toMatch(/^WBM \d/);
  });

  it("clamps the title to two lines and keeps the whole of it in title", () => {
    grid();
    const select = within(cards()[0]).getByRole("button", { name: LONG_TITLE });
    expect(select.getAttribute("title")).toBe(LONG_TITLE);
    const text = within(select).getByText(LONG_TITLE);
    expect(text.className).toContain("line-clamp-2");
  });

  it("puts the facts under the title in mono: model, years and resolution, then when it was published, then the tag", () => {
    grid();
    const [first, second] = cards();
    const facts = (card: HTMLElement) => card.querySelector("p.font-mono") as HTMLElement;
    expect(facts(first).firstChild?.textContent).toBe("WBM 1.0.0 · 2000–2009 · 5 arc-min");
    expect(facts(second).firstChild?.textContent).toBe("WBM 2.0.0 · 2000–2001 · 5 arc-min");
    expect(facts(first).querySelector("span")?.textContent).toMatch(/^Published /);
    expect(first.textContent).toContain("Publication");
    expect(second.textContent).toContain("Tutorial");
  });

  it("draws the bounding box as a map thumbnail, with the repository's Global or Regional label", () => {
    grid();
    expect(within(cards()[0]).getByRole("img", { name: /^Coverage: north 10°/ })).toBeTruthy();
    expect(within(cards()[0]).getByText("Regional")).toBeTruthy();
  });

  it("is selected by its title, the one control, which the facts describe", () => {
    const { onSelect } = grid();
    const select = within(cards()[1]).getByRole("button", { name: TUTORIAL.about.name });
    expect(select.className).toContain("after:absolute");
    expect(select.className).toContain("after:inset-0");
    const describedBy = select.getAttribute("aria-describedby") as string;
    expect(document.getElementById(describedBy)?.textContent).toContain("WBM 2.0.0 · 2000–2001 · 5 arc-min");
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
  it("come first when asked to, in the order they were given, and are marked", () => {
    grid({ datasets: [GLOBAL, TUTORIAL, WYOMING], usedIds: new Set(["wyoming", "tutorial"]) });
    expect(headings()).toEqual([TUTORIAL.about.name, WYOMING.about.name, LONG_TITLE]);
    expect(within(cards()[0]).getByText("Used before")).toBeTruthy();
    expect(within(cards()[1]).getByText("Used before")).toBeTruthy();
    expect(within(cards()[2]).queryByText("Used before")).toBeNull();
  });

  it("keep the order they came in when it is not asked, and are still marked", () => {
    grid({ datasets: [GLOBAL, TUTORIAL, WYOMING], usedIds: new Set(["wyoming"]), usedFirst: false });
    expect(headings()).toEqual([LONG_TITLE, TUTORIAL.about.name, WYOMING.about.name]);
    expect(within(cards()[2]).getByText("Used before")).toBeTruthy();
    expect(screen.getAllByText("Used before")).toHaveLength(1);
  });

  it("leave the order alone when there are none", () => {
    grid({ datasets: [GLOBAL, TUTORIAL, WYOMING] });
    expect(screen.queryByText("Used before")).toBeNull();
    expect(headings()).toEqual([LONG_TITLE, TUTORIAL.about.name, WYOMING.about.name]);
  });
});

describe("while a draft is being made", () => {
  it("covers the clicked card with a message, and turns every card off", () => {
    grid({ pendingId: "global", disabled: true });
    const [first, second] = cards();
    expect(within(first).getByRole("status").textContent).toContain("Opening");
    expect(within(first).getByRole("button", { name: LONG_TITLE }).getAttribute("aria-busy")).toBe("true");
    for (const button of screen.getAllByRole("button", { name: /^WBM / })) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    expect(within(second).queryByRole("status")).toBeNull();
    expect(second.querySelector("[data-slot=card]")?.className).toContain("pointer-events-none");
    expect(first.querySelector("[data-slot=card]")?.className).not.toContain("pointer-events-none");
  });
});
