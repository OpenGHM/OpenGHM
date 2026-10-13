import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { feedItem } from "./home-feed.fixtures";
import { DEFAULT_HOME_SETTINGS } from "@/lib/home/settings";

const { fetchHomeUpdates } = vi.hoisted(() => ({ fetchHomeUpdates: vi.fn() }));
vi.mock("@/lib/home/data", () => ({ fetchHomeUpdates }));

import { UpdatesSection } from "./updates-section";
import { UpdateCard } from "./update-card";

beforeEach(() => {
  fetchHomeUpdates.mockResolvedValue({ settings: DEFAULT_HOME_SETTINGS, items: [feedItem()] });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the home page's updates section", () => {
  it("shows the admin's label and title, the cards, and a link to all updates", async () => {
    fetchHomeUpdates.mockResolvedValue({
      settings: { ...DEFAULT_HOME_SETTINGS, eyebrow: "Fresh", title: "Our news" },
      items: [feedItem(), feedItem({ id: "n-2", title: "Second" })],
    });
    render(await UpdatesSection());
    expect(screen.getByText("Fresh")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Our news" })).toBeTruthy();
    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(screen.getByRole("link", { name: /View all updates/ }).getAttribute("href")).toBe("/news");
  });

  it("is left out when there is nothing to show", async () => {
    fetchHomeUpdates.mockResolvedValue({ settings: DEFAULT_HOME_SETTINGS, items: [] });
    expect(await UpdatesSection()).toBeNull();
  });

  it("is left out, without throwing, when the backend does not answer", async () => {
    fetchHomeUpdates.mockRejectedValue(new Error("connect ECONNREFUSED"));
    expect(await UpdatesSection()).toBeNull();
  });
});

describe("an update card", () => {
  it("shows the tag, title and summary, and is not a link without an address", () => {
    render(<UpdateCard item={feedItem()} />);
    const card = screen.getByRole("article");
    expect(within(card).getByText("Announcement").className).toMatch(/text-info/);
    expect(within(card).getByRole("heading", { name: "Python API v2.0 Released" })).toBeTruthy();
    expect(within(card).getByText("Major performance improvements.")).toBeTruthy();
    expect(within(card).queryByRole("link")).toBeNull();
  });

  it.each([
    ["dataset", "/images/update-dataset.jpg"],
    ["workshop", "/images/update-workshop.jpg"],
    ["news", "/images/update-api.jpg"],
  ] as const)("falls back to the picture of a %s when it has none", (kind, file) => {
    const { container } = render(<UpdateCard item={feedItem({ kind })} />);
    expect(container.querySelector("img")?.getAttribute("src")).toContain(encodeURIComponent(file));
  });

  it("draws a dataset's coverage on the world map, as its Data Repository card does", () => {
    const { container } = render(
      <UpdateCard item={feedItem({ kind: "dataset", coverage: { north: 50, south: 24, east: -66, west: -125 } })} />
    );
    expect(screen.getByRole("img", { name: /Coverage: north 50°, south 24°, east -66°, west -125°/ })).toBeTruthy();
    expect(screen.getAllByTestId("coverage-rect").length).toBeGreaterThan(0);
    // The shared picture is not used.
    expect(container.querySelector("img")).toBeNull();
  });

  it("shows its own cover, described by its alt text or else the title", () => {
    const { rerender } = render(
      <UpdateCard item={feedItem({ image: { url: "https://example.org/c.png", alt: "A map" } })} />
    );
    expect(screen.getByRole("img", { name: "A map" }).getAttribute("src")).toBe("https://example.org/c.png");
    rerender(<UpdateCard item={feedItem({ image: { url: "/api/community/files/0123456789abcdef01234567", alt: "" } })} />);
    expect(screen.getByRole("img", { name: "Python API v2.0 Released" })).toBeTruthy();
  });

  it("links through its link text, and opens an address on another site in a new tab", () => {
    const { rerender } = render(
      <UpdateCard item={feedItem({ href: "/repository/ds-1", link_label: "Access Data", kind: "dataset" })} />
    );
    const inner = screen.getByRole("link", { name: "Access Data" });
    expect(inner.getAttribute("href")).toBe("/repository/ds-1");
    expect(inner.getAttribute("target")).toBeNull();
    rerender(<UpdateCard item={feedItem({ href: "https://example.org/log", link_label: "Read Changelog" })} />);
    const outer = screen.getByRole("link", { name: /Read Changelog/ });
    expect(outer.getAttribute("target")).toBe("_blank");
    expect(outer.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("does not link to an address that is not safe", () => {
    render(<UpdateCard item={feedItem({ href: "javascript:alert(1)", link_label: "Click" })} />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("shows its date only when asked", () => {
    const { rerender } = render(<UpdateCard item={feedItem()} />);
    expect(screen.queryByText("October 10, 2026")).toBeNull();
    rerender(<UpdateCard item={feedItem()} showDate />);
    expect(screen.getByText("October 10, 2026")).toBeTruthy();
  });
});
