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

/** The card's one link: its name is the item's name and it holds nothing else. */
function onlyLink(name: string, href: string) {
  const links = screen.getAllByRole("link");
  expect(links).toHaveLength(1);
  expect(links[0].getAttribute("href")).toBe(href);
  expect(screen.getByRole("link", { name })).toBe(links[0]);
  expect(links[0].children).toHaveLength(0);
  return links[0];
}

describe("CatalogueCard for a model snapshot", () => {
  it("has exactly one link, the title, named for the item and pointing at the snapshot's page", () => {
    renderCard(snapshotItem());
    onlyLink("Global Storage Run", "/repository/snap-1");
  });

  it("has no View details, Download or Cite action", () => {
    renderCard(snapshotItem());
    expect(screen.queryByText(/View details|Download|Cite/)).toBeNull();
    expect(screen.queryByRole("link", { name: /View details|Download|Cite/ })).toBeNull();
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

  it("makes the title a foreground link that does not underline on hover, not a blue one", () => {
    renderCard(snapshotItem());
    const title = screen.getByRole("link", { name: /^Global Storage Run$/ });
    expect(title.className).not.toContain("underline");
    expect(title.className).not.toContain("text-primary");
    expect(title.closest("h3")?.className).toContain("text-foreground");
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
  it("has one link, to the model input's page", () => {
    renderCard(modelInputItem());
    onlyLink("Ancillary Data v1", "/repository/model-inputs/mi-1");
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

  it("do not open the card when pressed: the chip is not inside the link, and the press only reports the toggle", () => {
    const { onToggleKeyword } = renderCard(snapshotItem());
    const link = screen.getByRole("link", { name: /^Global Storage Run$/ });
    const onLinkClick = vi.fn();
    link.addEventListener("click", onLinkClick);
    const chip = screen.getByRole("button", { name: "Filter by keyword storage" });
    expect(chip.closest("a")).toBeNull();
    fireEvent.click(chip);
    expect(onToggleKeyword).toHaveBeenCalledWith("storage");
    expect(onLinkClick).not.toHaveBeenCalled();
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

  it("do not open the card when pressed", () => {
    const { onToggleTag } = renderCard(snapshotItem());
    const onLinkClick = vi.fn();
    screen.getByRole("link").addEventListener("click", onLinkClick);
    fireEvent.click(screen.getByRole("button", { name: "Filter by tag Publication" }));
    expect(onToggleTag).toHaveBeenCalledWith("publication");
    expect(onLinkClick).not.toHaveBeenCalled();
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
  it("makes the whole card the title link's target, with the title as the only link", () => {
    const { container } = renderCard(snapshotItem());
    const card = container.firstElementChild!;
    const title = screen.getByRole("link", { name: /^Global Storage Run$/ });
    expect(title.className).toContain("after:absolute");
    expect(title.className).toContain("after:inset-0");
    expect(card.className).toContain("relative");
    expect(card.className).toContain("cursor-pointer");
    expect(card.querySelectorAll("a")).toHaveLength(1);
    expect(card.querySelector("a a")).toBeNull();
  });

  it("shows the focus ring on the whole card when the title link has keyboard focus, not on the text", () => {
    const { container } = renderCard(snapshotItem());
    const card = container.firstElementChild!;
    expect(card.className).toContain("has-[a:focus-visible]:ring-[3px]");
    expect(card.className).toContain("has-[a:focus-visible]:ring-ring/50");
    const title = screen.getByRole("link", { name: /^Global Storage Run$/ });
    expect(title.className).toContain("outline-none");
    expect(title.className).not.toContain("focus-visible:ring");
  });

  it.each(["list", "grid"] as const)("lifts, deepens its shadow and tints its border on hover in the %s view, the lift only with motion allowed", (view) => {
    const { container } = renderCard(snapshotItem(), [], view);
    const card = container.firstElementChild!;
    expect(card.className).toContain("group/card");
    expect(card.className).toContain("motion-safe:hover:-translate-y-0.5");
    expect(card.className).toContain("hover:shadow-[0_12px_32px_-12px_rgb(0_0_0/0.18)]");
    expect(card.className).toContain("hover:border-primary/30");
    expect(card.className).toContain("transition-[translate,box-shadow,border-color]");
    expect(card.className).not.toContain("motion-reduce:transition-none");
    expect(card.className).not.toMatch(/(^|\s)hover:-translate-y/);
  });

  it.each(["list", "grid"] as const)("keeps the title colour on hover and focus in the %s view", (view) => {
    renderCard(snapshotItem(), [], view);
    const heading = screen.getByRole("heading", { level: 3 });
    expect(heading.className).not.toContain("text-primary");
    expect(heading.className).not.toContain("transition-colors");
    expect(heading.className).not.toContain("underline");
  });

  it.each(["list", "grid"] as const)("shows a decorative arrow in the map panel's corner on hover or focus in the %s view", (view) => {
    const { container } = renderCard(snapshotItem(), [], view);
    const arrow = container.querySelector("span[aria-hidden='true'].size-8")!;
    expect(arrow).not.toBeNull();
    expect(arrow.className).toContain("pointer-events-none");
    expect(arrow.className).toContain("opacity-0");
    expect(arrow.className).toContain("group-hover/card:opacity-100");
    expect(arrow.className).toContain("group-has-[a:focus-visible]/card:opacity-100");
    expect(arrow.className).toContain("motion-safe:translate-y-1");
    expect(arrow.className).toContain("motion-safe:group-hover/card:translate-y-0");
    expect(arrow.className).toContain("top-3");
    expect(arrow.className).toContain("right-3");
    expect(arrow.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(arrow.closest("a, button")).toBeNull();
    expect(arrow.querySelector("a, button")).toBeNull();
    expect(container.querySelectorAll("a")).toHaveLength(1);
  });

  it("scales the map only, the corner label and the panel frame staying put", () => {
    const { container } = renderCard(snapshotItem(), [], "grid");
    const svg = container.querySelector("svg[role='img']")!;
    expect(svg.getAttribute("class")).toContain("motion-safe:group-hover/card:scale-[1.06]");
    expect(svg.getAttribute("class")).toContain("duration-700");
    expect(svg.parentElement!.className).toContain("overflow-hidden");
    expect(screen.getByText("Global").className).not.toContain("scale");
  });

  it("puts the published date at the top of the list card, beside the mono contents line", () => {
    renderCard(snapshotItem());
    const published = screen.getByText(/^Published/);
    expect(published.className).toContain("text-muted-foreground");
    expect(published.parentElement).toBe(screen.getByText("WBM 1.0.0 · GPL-3.0-only").parentElement);
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
    "is hidden from assistive technology and has no links or buttons in the %s view",
    (view) => {
      const { container } = render(<CatalogueCardSkeleton view={view} />);
      expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
      expect(container.querySelectorAll("a, button")).toHaveLength(0);
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

  it("has exactly one link, the title, and no action buttons, keywords or Cite", () => {
    renderCard(snapshotItem(), [], "grid");
    onlyLink("Global Storage Run", "/repository/snap-1");
    expect(screen.queryByText(/View|Download|Cite/)).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText("Publication")).toBeNull();
  });

  it("is a whole-card link with the card focus ring and hover lift", () => {
    const { container } = renderCard(snapshotItem(), [], "grid");
    const card = container.firstElementChild!;
    expect(card.className).toContain("relative");
    expect(card.className).toContain("cursor-pointer");
    expect(card.className).toContain("hover:shadow-[0_12px_32px_-12px_rgb(0_0_0/0.18)]");
    expect(card.className).toContain("has-[a:focus-visible]:ring-[3px]");
    const title = screen.getByRole("link");
    expect(title.className).toContain("after:absolute");
    expect(title.className).not.toContain("underline");
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
    onlyLink("Ancillary Data v1", "/repository/model-inputs/mi-1");
  });
});
