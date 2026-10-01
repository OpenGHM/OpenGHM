import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { CatalogueCard, CatalogueCardSkeleton } from "./catalogue-card";
import { modelInputItem, snapshotItem } from "./catalogue.fixtures";

afterEach(cleanup);

function hrefOf(name: RegExp): string | null {
  return screen.getByRole("link", { name }).getAttribute("href");
}

describe("CatalogueCard for a model snapshot", () => {
  it("links the title, View details, Download and Cite to the snapshot's page", () => {
    render(<CatalogueCard item={snapshotItem()} />);
    expect(hrefOf(/^Global Storage Run$/)).toBe("/repository/snap-1");
    expect(hrefOf(/^View details/)).toBe("/repository/snap-1");
    expect(hrefOf(/^Download/)).toBe("/repository/snap-1#download");
    expect(hrefOf(/^Cite/)).toBe("/repository/snap-1#cite");
  });

  it("shows the Model Snapshot badge, the meta row and the category", () => {
    render(<CatalogueCard item={snapshotItem()} />);
    expect(screen.getByText("Model Snapshot")).toBeTruthy();
    expect(screen.getByText("Ada Hydro +1")).toBeTruthy();
    expect(screen.getByText("2000 – 2009")).toBeTruthy();
    expect(screen.getByText("5 arc-minute")).toBeTruthy();
    expect(screen.getByText("WBM 1.0.0")).toBeTruthy();
    expect(screen.getByText("GPL-3.0-only")).toBeTruthy();
    expect(screen.getByText("hydrology")).toBeTruthy();
  });

  it("lists three output variables and how many more there are", () => {
    render(<CatalogueCard item={snapshotItem()} />);
    for (const name of ["discharge", "runoff", "soilMoisture"]) {
      expect(screen.getByText(name)).toBeTruthy();
    }
    expect(screen.queryByText("evapotranspiration")).toBeNull();
    expect(screen.getByText("+2 more")).toBeTruthy();
  });

  it("clamps the description to two lines and shows the published date", () => {
    const { container } = render(<CatalogueCard item={snapshotItem()} />);
    expect(screen.getByText(/Monthly storage terms/).className).toContain("line-clamp-2");
    // TimeStamp prints the date in the viewer's locale; the machine value is fixed.
    const published = container.querySelector("time");
    expect(published?.getAttribute("datetime")).toBe("2026-03-14T10:00:00Z");
    expect(published?.textContent).toContain("2026");
    expect(screen.getByText(/^Published/)).toBeTruthy();
  });

  it("draws the coverage thumbnail with its label", () => {
    render(<CatalogueCard item={snapshotItem()} />);
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("(Global)");
  });
});

describe("CatalogueCard for a model input", () => {
  it("links to the model input's page", () => {
    render(<CatalogueCard item={modelInputItem()} />);
    expect(hrefOf(/^Ancillary Data v1$/)).toBe("/repository/model-inputs/mi-1");
    expect(hrefOf(/^Download/)).toBe("/repository/model-inputs/mi-1#download");
    expect(hrefOf(/^Cite/)).toBe("/repository/model-inputs/mi-1#cite");
  });

  it("shows the Model Input badge in the info tint, datasets and networks, and distinct resolutions", () => {
    render(<CatalogueCard item={modelInputItem()} />);
    expect(screen.getByText("Model Input").className).toContain("bg-info/10");
    expect(screen.getByText("3 datasets · 3 networks")).toBeTruthy();
    expect(screen.getByText("5 arc-minute, 30 arc-second")).toBeTruthy();
    expect(screen.getByText("Climatological")).toBeTruthy();
  });

  it("shows three keywords and +2 more", () => {
    render(<CatalogueCard item={modelInputItem()} />);
    expect(screen.getByText("network")).toBeTruthy();
    expect(screen.getByText("land cover")).toBeTruthy();
    expect(screen.queryByText("elevation")).toBeNull();
    expect(screen.getByText("+2 more")).toBeTruthy();
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("(Regional)");
  });

  it("leaves the resolution out when no network has one", () => {
    render(<CatalogueCard item={modelInputItem({ networks: [{ file: "a.nc" }] })} />);
    expect(screen.queryByText(/arc-/)).toBeNull();
    expect(screen.getByText("3 datasets · 1 network")).toBeTruthy();
  });
});

describe("CatalogueCard layout", () => {
  it("keeps the action links above the title's stretched link, each with a focus ring", () => {
    render(<CatalogueCard item={snapshotItem()} />);
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
    const { container } = render(<CatalogueCard item={snapshotItem()} />);
    expect(screen.getByRole("heading", { level: 3 }).className).toContain("break-words");
    const meta = within(container).getByText("Ada Hydro +1");
    expect(meta.className).toContain("truncate");
    // The card is a row from sm and a column below it, with the thumbnail first.
    expect(container.firstElementChild?.className).toContain("sm:flex-row");
    expect(container.querySelector(".order-first")).not.toBeNull();
  });

  it("uses no raw colour", () => {
    const { container } = render(<CatalogueCard item={modelInputItem()} />);
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
