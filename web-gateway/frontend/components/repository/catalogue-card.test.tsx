import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { CatalogueItem } from "@/lib/repository/types";
import { CatalogueCard, CatalogueCardSkeleton } from "./catalogue-card";
import { modelInputItem, snapshotItem } from "./catalogue.fixtures";

afterEach(cleanup);

function renderCard(item: CatalogueItem, selectedKeywords: string[] = []) {
  const onToggleKeyword = vi.fn();
  const view = render(
    <CatalogueCard item={item} selectedKeywords={selectedKeywords} onToggleKeyword={onToggleKeyword} />
  );
  return { ...view, onToggleKeyword };
}

function hrefOf(name: RegExp): string | null {
  return screen.getByRole("link", { name }).getAttribute("href");
}

describe("CatalogueCard for a model snapshot", () => {
  it("links the title, View details, Download and Cite to the snapshot's page", () => {
    renderCard(snapshotItem());
    expect(hrefOf(/^Global Storage Run$/)).toBe("/repository/snap-1");
    expect(hrefOf(/^View details/)).toBe("/repository/snap-1");
    expect(hrefOf(/^Download/)).toBe("/repository/snap-1#download");
    expect(hrefOf(/^Cite/)).toBe("/repository/snap-1#cite");
  });

  it("shows the Model Snapshot badge, the meta row and the category", () => {
    renderCard(snapshotItem());
    expect(screen.getByText("Model Snapshot")).toBeTruthy();
    expect(screen.getByText("Ada Hydro +1")).toBeTruthy();
    expect(screen.getByText("2000 – 2009")).toBeTruthy();
    expect(screen.getByText("5 arc-minute")).toBeTruthy();
    expect(screen.getByText("WBM 1.0.0")).toBeTruthy();
    expect(screen.getByText("GPL-3.0-only")).toBeTruthy();
    expect(screen.getByText("hydrology")).toBeTruthy();
  });

  it("shows the category and four keywords, not the output variables", () => {
    renderCard(snapshotItem());
    for (const name of ["storage", "water balance", "global", "monthly"]) {
      expect(screen.getByText(name)).toBeTruthy();
    }
    expect(screen.queryByText("reservoirs")).toBeNull();
    for (const name of ["discharge", "runoff", "soilMoisture"]) {
      expect(screen.queryByText(name)).toBeNull();
    }
    const more = screen.getByText("+2 more");
    expect(more.title).toBe("reservoirs, streamflow");
    expect(within(more.closest("ul")!).getAllByRole("button")).toHaveLength(4);
  });

  it("clamps the description to two lines and shows the published date", () => {
    const { container } = renderCard(snapshotItem());
    expect(screen.getByText(/Monthly storage terms/).className).toContain("line-clamp-2");
    // TimeStamp prints the date in the viewer's locale; the machine value is fixed.
    const published = container.querySelector("time");
    expect(published?.getAttribute("datetime")).toBe("2026-03-14T10:00:00Z");
    expect(published?.textContent).toContain("2026");
    expect(screen.getByText(/^Published/)).toBeTruthy();
  });

  it("draws the coverage thumbnail with its label", () => {
    renderCard(snapshotItem());
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("(Global)");
  });
});

describe("CatalogueCard for a model input", () => {
  it("links to the model input's page", () => {
    renderCard(modelInputItem());
    expect(hrefOf(/^Ancillary Data v1$/)).toBe("/repository/model-inputs/mi-1");
    expect(hrefOf(/^Download/)).toBe("/repository/model-inputs/mi-1#download");
    expect(hrefOf(/^Cite/)).toBe("/repository/model-inputs/mi-1#cite");
  });

  it("shows the Model Input badge in the info tint, datasets and networks, and distinct resolutions", () => {
    renderCard(modelInputItem());
    expect(screen.getByText("Model Input").className).toContain("bg-info/10");
    expect(screen.getByText("3 datasets · 3 networks")).toBeTruthy();
    expect(screen.getByText("5 arc-minute, 30 arc-second")).toBeTruthy();
    expect(screen.getByText("Climatological")).toBeTruthy();
  });

  it("shows the category and four keywords and +1 more", () => {
    renderCard(modelInputItem());
    expect(screen.getByText("ancillary")).toBeTruthy();
    expect(screen.getByText("network")).toBeTruthy();
    expect(screen.getByText("elevation")).toBeTruthy();
    expect(screen.queryByText("lakes")).toBeNull();
    expect(screen.getByText("+1 more").title).toBe("lakes");
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("(Regional)");
  });

  it("shows no +N more when the keywords fit", () => {
    const base = modelInputItem();
    renderCard({ ...base, about: { ...base.about, keywords: ["network", "soils"] } } as CatalogueItem);
    expect(screen.queryByText(/more$/)).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("leaves the resolution out when no network has one", () => {
    renderCard(modelInputItem({ networks: [{ file: "a.nc" }] }));
    expect(screen.queryByText(/arc-/)).toBeNull();
    expect(screen.getByText("3 datasets · 1 network")).toBeTruthy();
  });
});

describe("CatalogueCard keyword chips", () => {
  it.each([
    ["snapshot", snapshotItem() as CatalogueItem, "storage"],
    ["model input", modelInputItem(), "soils"],
  ])("are buttons named for their keyword on a %s card, and report a press", (_k, item, keyword) => {
    const { onToggleKeyword } = renderCard(item);
    const chip = screen.getByRole("button", { name: `Filter by keyword ${keyword}` });
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(chip);
    expect(onToggleKeyword).toHaveBeenCalledWith(keyword);
  });

  it("show a selected style, with a check, for the keywords already in the filter", () => {
    renderCard(snapshotItem(), ["global"]);
    const on = screen.getByRole("button", { name: "Filter by keyword global" });
    expect(on.getAttribute("aria-pressed")).toBe("true");
    expect(on.querySelector("svg")).not.toBeNull();
    expect(on.innerHTML).toContain("bg-primary text-primary-foreground");
    const off = screen.getByRole("button", { name: "Filter by keyword storage" });
    expect(off.getAttribute("aria-pressed")).toBe("false");
    expect(off.querySelector("svg")).toBeNull();
  });

  it("are 40 px targets on a phone, above the stretched link, with a focus ring on the chip", () => {
    renderCard(snapshotItem());
    const chip = screen.getByRole("button", { name: "Filter by keyword storage" });
    expect(chip.className).toContain("min-h-10");
    expect(chip.className).toContain("sm:min-h-0");
    expect(chip.className).toContain("z-10");
    expect(chip.className).toContain("outline-none");
    expect(chip.firstElementChild?.className).toContain("group-focus-visible/keyword:ring");
  });

  it("leave the category as plain text", () => {
    renderCard(snapshotItem());
    expect(screen.getByText("hydrology").closest("button")).toBeNull();
    expect(screen.queryByRole("button", { name: /hydrology/ })).toBeNull();
  });

  it("do not follow the card's link when pressed", () => {
    // The chip is a button next to the title link, not inside it.
    renderCard(snapshotItem());
    const chip = screen.getByRole("button", { name: "Filter by keyword storage" });
    expect(chip.closest("a")).toBeNull();
  });
});

describe("CatalogueCard layout", () => {
  it("keeps the action links above the title's stretched link, each with a focus ring", () => {
    renderCard(snapshotItem());
    const title = screen.getByRole("link", { name: /^Global Storage Run$/ });
    expect(title.className).toContain("after:absolute");
    expect(title.className).toContain("focus-visible:ring");
    for (const name of [/^View details/, /^Download/, /^Cite/]) {
      const link = screen.getByRole("link", { name });
      expect(link.className).toContain("z-10");
      expect(link.className).toContain("focus-visible:ring");
      expect(link.className).toContain("min-h-10");
    }
  });

  it("lets long text wrap or truncate instead of overflowing", () => {
    const { container } = renderCard(snapshotItem());
    expect(screen.getByRole("heading", { level: 3 }).className).toContain("break-words");
    const meta = within(container).getByText("Ada Hydro +1");
    expect(meta.className).toContain("truncate");
    // The card is a row from sm and a column below it, with the thumbnail first.
    expect(container.firstElementChild?.className).toContain("sm:flex-row");
    expect(container.querySelector(".order-first")).not.toBeNull();
  });

  it("uses no raw colour", () => {
    const { container } = renderCard(modelInputItem());
    expect(container.innerHTML).not.toMatch(/(?:bg|text|border)-(?:red|green|emerald|teal|sky|blue)-\d/);
  });
});

describe("CatalogueCardSkeleton", () => {
  it("is hidden from assistive technology and has no links", () => {
    const { container } = render(<CatalogueCardSkeleton />);
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(container.querySelector(".motion-safe\\:animate-pulse")).not.toBeNull();
  });
});
