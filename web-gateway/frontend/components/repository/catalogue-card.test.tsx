import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { CatalogueItem, CatalogueView } from "@/lib/repository/types";
import { CatalogueCard, CatalogueCardSkeleton } from "./catalogue-card";
import { modelInputItem, snapshotItem } from "./catalogue.fixtures";

afterEach(cleanup);

function renderCard(
  item: CatalogueItem,
  selectedKeywords: string[] = [],
  layout: CatalogueView = "list",
  selectedTags: string[] = []
) {
  const onToggleKeyword = vi.fn();
  const onToggleTag = vi.fn();
  const view = render(
    <CatalogueCard
      item={item}
      view={layout}
      selectedTags={selectedTags}
      selectedKeywords={selectedKeywords}
      onToggleTag={onToggleTag}
      onToggleKeyword={onToggleKeyword}
    />
  );
  return { ...view, onToggleKeyword, onToggleTag };
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

  it("names every action link for the item", () => {
    renderCard(snapshotItem());
    for (const name of ["View details for Global Storage Run", "Download Global Storage Run", "Cite Global Storage Run"]) {
      expect(screen.getByRole("link", { name })).toBeTruthy();
    }
  });

  it("shows the Model Snapshot badge in the brand tint, the mono version and licence line, and the tags", () => {
    renderCard(snapshotItem());
    expect(screen.getByText("Model Snapshot").className).toContain("bg-primary/10");
    const line = screen.getByText("WBM 1.0.0 · GPL-3.0-only");
    expect(line.className).toContain("font-mono");
    expect(screen.getByText("Publication")).toBeTruthy();
    expect(screen.getByText("Climate forcing")).toBeTruthy();
  });

  it("shows Authors, Coverage and Resolution with the values in mono", () => {
    renderCard(snapshotItem());
    for (const label of ["Authors", "Coverage", "Resolution"]) {
      expect(screen.getByText(label).className).toContain("uppercase");
    }
    expect(screen.getByText("Ada Hydro +1").title).toBe("Ada Hydro, Bo Flow");
    expect(screen.getByText("2000–2009").className).toContain("font-mono");
    expect(screen.getByText("5 arc-min").className).toContain("font-mono");
  });

  it("makes the title a foreground link that underlines on hover, not a blue one", () => {
    renderCard(snapshotItem());
    const title = screen.getByRole("link", { name: /^Global Storage Run$/ });
    expect(title.className).toContain("hover:underline");
    expect(title.className).not.toContain("text-primary");
    expect(title.closest("h3")?.className).toContain("text-foreground");
  });

  it("has a dark View details button and plain Download and Cite", () => {
    renderCard(snapshotItem());
    const view = screen.getByRole("link", { name: /^View details/ });
    expect(view.className).toContain("bg-foreground");
    expect(view.className).toContain("text-background");
    expect(screen.getByRole("link", { name: /^Download/ }).className).not.toContain("bg-foreground");
  });

  it("shows every tag and four keywords, not the output variables", () => {
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
    // Two tag chips and four keyword chips, all buttons.
    expect(within(more.closest("ul")!).getAllByRole("button")).toHaveLength(6);
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
    expect(screen.getAllByRole("img")[0].getAttribute("aria-label")).toContain("(Global)");
  });

  it("draws a wide thumbnail below the content and a tall one beside it, one per breakpoint", () => {
    const { container } = renderCard(modelInputItem());
    const svgs = [...container.querySelectorAll("svg[role='img']")];
    expect(svgs).toHaveLength(2);
    const [wide, tall] = svgs.map((svg) => svg.getAttribute("viewBox")!.split(" ").map(Number));
    expect(wide[2] / wide[3]).toBeCloseTo(2.2);
    expect(tall[2] / tall[3]).toBeCloseTo(0.7);
    expect(svgs[0].parentElement?.classList.contains("md:hidden")).toBe(true);
    expect(svgs[1].parentElement?.classList.contains("hidden")).toBe(true);
    expect(svgs[1].parentElement?.classList.contains("md:block")).toBe(true);
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
    expect(screen.getByText("Model Input").className).toContain("bg-compute/10");
    expect(screen.getByText("3 datasets · 3 networks · CC-BY-4.0")).toBeTruthy();
    expect(screen.getByText("5 arc-min, 30 arc-sec")).toBeTruthy();
    expect(screen.getByText("Climatological")).toBeTruthy();
  });

  it("shows every tag and four keywords and +1 more", () => {
    renderCard(modelInputItem());
    expect(screen.getByText("Ancillary data")).toBeTruthy();
    expect(screen.getByText("River network")).toBeTruthy();
    expect(screen.getByText("network")).toBeTruthy();
    expect(screen.getByText("elevation")).toBeTruthy();
    expect(screen.queryByText("lakes")).toBeNull();
    expect(screen.getByText("+1 more").title).toBe("lakes");
    expect(screen.getAllByRole("img")[0].getAttribute("aria-label")).toContain("(Regional)");
  });

  it("shows no +N more when the keywords fit", () => {
    const base = modelInputItem();
    renderCard({ ...base, about: { ...base.about, keywords: ["network", "soils"] } } as CatalogueItem);
    expect(screen.queryByText(/more$/)).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(4);
  });

  it("leaves the resolution out when no network has one", () => {
    renderCard(modelInputItem({ networks: [{ file: "a.nc" }] }));
    expect(screen.queryByText(/arc-/)).toBeNull();
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.getByText("3 datasets · 1 network · CC-BY-4.0")).toBeTruthy();
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

  it("do not follow the card's link when pressed", () => {
    // The chip is a button next to the title link, not inside it.
    renderCard(snapshotItem());
    const chip = screen.getByRole("button", { name: "Filter by keyword storage" });
    expect(chip.closest("a")).toBeNull();
  });
});

describe("CatalogueCard tag chips", () => {
  it("are buttons named for their readable tag, one per tag, before the keywords", () => {
    renderCard(snapshotItem());
    const publication = screen.getByRole("button", { name: "Filter by tag Publication" });
    const forcing = screen.getByRole("button", { name: "Filter by tag Climate forcing" });
    const firstKeyword = screen.getByRole("button", { name: "Filter by keyword storage" });
    expect(publication.getAttribute("aria-pressed")).toBe("false");
    expect(forcing.getAttribute("aria-pressed")).toBe("false");
    expect(publication.compareDocumentPosition(forcing) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(forcing.compareDocumentPosition(firstKeyword) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each([
    ["snapshot", snapshotItem() as CatalogueItem, "Publication", "publication"],
    ["model input", modelInputItem(), "River network", "river-network"],
  ])("report the raw tag value on a press, on a %s card", (_k, item, label, raw) => {
    const { onToggleTag, onToggleKeyword } = renderCard(item);
    fireEvent.click(screen.getByRole("button", { name: `Filter by tag ${label}` }));
    expect(onToggleTag).toHaveBeenCalledWith(raw);
    expect(onToggleKeyword).not.toHaveBeenCalled();
  });

  it("show a selected style, with a check, for each tag already in the filter, several at once", () => {
    renderCard(snapshotItem(), [], "list", ["publication", "climate-forcing"]);
    for (const name of ["Filter by tag Publication", "Filter by tag Climate forcing"]) {
      const on = screen.getByRole("button", { name });
      expect(on.getAttribute("aria-pressed")).toBe("true");
      expect(on.querySelector("svg")).not.toBeNull();
      expect(on.innerHTML).toContain("bg-primary text-primary-foreground");
    }
  });

  it("wear the primary tint when off, and have no check", () => {
    renderCard(snapshotItem(), [], "list", ["climate-forcing"]);
    const off = screen.getByRole("button", { name: "Filter by tag Publication" });
    expect(off.innerHTML).toContain("bg-primary/10");
    expect(off.querySelector("svg")).toBeNull();
  });

  it("are 40 px targets on a phone, above the stretched link, with a focus ring on the chip", () => {
    renderCard(snapshotItem());
    const chip = screen.getByRole("button", { name: "Filter by tag Publication" });
    expect(chip.className).toContain("min-h-10");
    expect(chip.className).toContain("sm:min-h-0");
    expect(chip.className).toContain("z-10");
    expect(chip.className).toContain("outline-none");
    expect(chip.firstElementChild?.className).toContain("group-focus-visible/tag:ring");
    expect(chip.closest("a")).toBeNull();
  });

  it("keep a tag toggle and a same-named keyword toggle apart", () => {
    const base = snapshotItem();
    const { onToggleTag, onToggleKeyword } = renderCard({
      ...base,
      about: { ...base.about, keywords: ["test"], tags: ["test"] },
    } as CatalogueItem);
    fireEvent.click(screen.getByRole("button", { name: "Filter by keyword test" }));
    expect(onToggleKeyword).toHaveBeenCalledWith("test");
    expect(onToggleTag).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Filter by tag Test" }));
    expect(onToggleTag).toHaveBeenCalledWith("test");
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

  it("lets long text wrap instead of overflowing", () => {
    renderCard(snapshotItem());
    expect(screen.getByRole("heading", { level: 3 }).className).toContain("break-words");
    expect(screen.getByText("Ada Hydro +1").className).toContain("break-words");
  });

  it("puts the map panel beside the content from md and below it on a phone", () => {
    const { container } = renderCard(snapshotItem());
    const card = container.firstElementChild!;
    expect(card.className).toContain("md:flex-row");
    // The panel comes last in the document, so it sits below the content on a phone.
    const panel = card.lastElementChild!;
    expect(panel.querySelector("svg")).not.toBeNull();
    expect(panel.className).toContain("h-36");
    expect(panel.className).toContain("md:w-[260px]");
    expect(card.firstElementChild?.querySelector("svg[role='img']")).toBeNull();
  });

  it("uses no raw colour", () => {
    const { container } = renderCard(modelInputItem());
    expect(container.innerHTML).not.toMatch(/(?:bg|text|border)-(?:red|green|emerald|teal|sky|blue)-\d/);
  });
});

describe("CatalogueCardSkeleton", () => {
  it.each<CatalogueView>(["list", "grid"])(
    "is hidden from assistive technology and has no links in the %s view",
    (view) => {
      const { container } = render(<CatalogueCardSkeleton view={view} />);
      expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
      expect(container.querySelectorAll("a")).toHaveLength(0);
      expect(container.querySelector(".motion-safe\\:animate-pulse")).not.toBeNull();
    }
  );
});

describe("CatalogueCard in the grid view", () => {
  it("shows the map first, then the badge, the title and the compact coverage line", () => {
    const { container } = renderCard(snapshotItem(), [], "grid");
    const card = container.firstElementChild!;
    expect(card.firstElementChild?.className).toContain("h-[150px]");
    expect(card.firstElementChild?.querySelector("svg[role='img']")).not.toBeNull();
    expect(screen.getByText("Model Snapshot").className).toContain("bg-primary/10");
    expect(screen.getByRole("heading", { level: 3 }).className).toContain("line-clamp-4");
    expect(screen.getByText("2000–2009 · 5 arc-min").className).toContain("font-mono");
  });

  it("links the title, View and Download to the detail page and leaves out Cite and the keywords", () => {
    renderCard(snapshotItem(), [], "grid");
    expect(hrefOf(/^Global Storage Run$/)).toBe("/repository/snap-1");
    expect(hrefOf(/^View details for Global Storage Run$/)).toBe("/repository/snap-1");
    expect(hrefOf(/^Download Global Storage Run$/)).toBe("/repository/snap-1#download");
    expect(screen.queryByRole("link", { name: /Cite/ })).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText("Publication")).toBeNull();
    expect(screen.getByText("View").closest("a")?.className).toContain("bg-foreground");
  });

  it("shows the date alone, with the machine value in the time element", () => {
    const { container } = renderCard(snapshotItem(), [], "grid");
    expect(container.querySelector("time")?.getAttribute("datetime")).toBe("2026-03-14T10:00:00Z");
    expect(screen.queryByText(/^Published/)).toBeNull();
  });

  it("describes a model input the same way", () => {
    renderCard(modelInputItem(), [], "grid");
    expect(screen.getByText("Model Input").className).toContain("bg-compute/10");
    expect(screen.getByText("Climatological · 5 arc-min, 30 arc-sec")).toBeTruthy();
    expect(hrefOf(/^Download/)).toBe("/repository/model-inputs/mi-1#download");
  });
});
