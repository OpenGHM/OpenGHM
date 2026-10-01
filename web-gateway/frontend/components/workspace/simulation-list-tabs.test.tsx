import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { SimulationListTabs } from "@/components/workspace/simulation-list-tabs";
import { STATUS_TABS, listHref, tabForStatus } from "@/lib/jobs/filters";

afterEach(cleanup);

const STATS = { total: 12, running: 3, completed: 4, failed: 1, draft: 2, cancelled: 2 };

function links() {
  return within(screen.getByRole("navigation", { name: "Filter simulations" })).getAllByRole("link");
}

describe("the list's tab bar", () => {
  it("is one link per bucket, each with its count", () => {
    render(<SimulationListTabs active={tabForStatus(undefined)} stats={STATS} />);
    expect(links().map((a) => a.textContent)).toEqual([
      "All12",
      "Draft2",
      "Active3",
      "Completed4",
      "Failed1",
      "Cancelled2",
    ]);
    expect(links().map((a) => a.getAttribute("href"))).toEqual([
      "/workspace",
      "/workspace?status=DRAFT",
      "/workspace?status=active",
      "/workspace?status=COMPLETED",
      "/workspace?status=FAILED",
      "/workspace?status=CANCELLED",
    ]);
  });

  it("marks the selected tab with aria-current, and only that one", () => {
    render(<SimulationListTabs active={tabForStatus("DRAFT")} stats={STATS} />);
    const current = links().filter((a) => a.getAttribute("aria-current") === "page");
    expect(current.map((a) => a.textContent)).toEqual(["Draft2"]);
  });

  it("reads the status the way the backend does, without regard to case", () => {
    expect(tabForStatus("completed")?.label).toBe("Completed");
    expect(tabForStatus("ACTIVE")?.label).toBe("Active");
    expect(tabForStatus(undefined)?.label).toBe("All");
    expect(tabForStatus("nonsense")).toBeUndefined();
  });

  it("selects no tab for a status that matches none", () => {
    render(<SimulationListTabs active={tabForStatus("nonsense")} stats={STATS} />);
    expect(links().some((a) => a.hasAttribute("aria-current"))).toBe(false);
  });

  it("drops the counts, rather than showing zeros, when they could not be loaded", () => {
    render(<SimulationListTabs active={STATUS_TABS[0]} stats={null} />);
    expect(links().map((a) => a.textContent)).toEqual([
      "All", "Draft", "Active", "Completed", "Failed", "Cancelled",
    ]);
  });

  it("scrolls inside itself on a narrow screen and keeps every target 40 px tall", () => {
    render(<SimulationListTabs active={STATUS_TABS[0]} stats={STATS} />);
    const nav = screen.getByRole("navigation", { name: "Filter simulations" });
    expect(nav.className).toContain("overflow-x-auto");
    expect(nav.className).toContain("max-w-full");
    for (const a of links()) expect(a.className).toContain("min-h-10");
  });
});

describe("the list's URLs", () => {
  it("keeps the status and leaves the first page unnumbered", () => {
    expect(listHref(undefined)).toBe("/workspace");
    expect(listHref("FAILED")).toBe("/workspace?status=FAILED");
    expect(listHref("FAILED", 1)).toBe("/workspace?status=FAILED");
    expect(listHref("FAILED", 3)).toBe("/workspace?status=FAILED&page=3");
    expect(listHref(undefined, 2)).toBe("/workspace?page=2");
  });
});
