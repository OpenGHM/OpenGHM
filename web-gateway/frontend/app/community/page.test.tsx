import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { communityPage } from "@/components/community/community.fixtures";

const { fetchCommunityPage } = vi.hoisted(() => ({ fetchCommunityPage: vi.fn() }));
// lib/community/data reaches next-auth through the API client; the page itself no longer reads the session.
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/community/data", async () => ({
  ...(await vi.importActual<typeof import("@/lib/community/data")>("@/lib/community/data")),
  fetchCommunityPage,
}));
// The Header reads the session through next-auth/react; the page test is about the page.
vi.mock("@/components/landing/header", () => ({ Header: () => <header data-testid="header" /> }));
vi.mock("@/components/landing/footer", () => ({ Footer: () => <footer data-testid="footer" /> }));

import CommunityPage from "./page";
import { DEFAULT_COMMUNITY_SETTINGS } from "@/lib/community/settings";

beforeEach(() => {
  fetchCommunityPage.mockResolvedValue(communityPage());
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderPage(searchParams: Record<string, string | string[] | undefined> = {}) {
  render(await CommunityPage({ searchParams: Promise.resolve(searchParams) }));
}

describe("the Community page", () => {
  it("shows the band with the admin's heading and intro, and every section", async () => {
    fetchCommunityPage.mockResolvedValue(
      communityPage({ settings: { ...DEFAULT_COMMUNITY_SETTINGS, hero_title: "Our community", hero_intro: "Everything in one place." } }),
    );
    await renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Our community" })).toBeTruthy();
    expect(screen.getByText("Everything in one place.")).toBeTruthy();
    expect(screen.getByText("Community", { selector: "p" })).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Workshops",
      "Tutorials",
      "Publications",
      "Discussion groups",
    ]);
    expect(screen.getByRole("link", { name: "All" }).getAttribute("aria-current")).toBe("page");
  });

  it("shows one section for ?tab=, and the tab is current", async () => {
    await renderPage({ tab: "publications" });
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Publications"]);
    expect(screen.getByRole("link", { name: "Publications" }).getAttribute("aria-current")).toBe("page");
  });

  it("treats an unknown tab as All, and Groups as All when groups are off", async () => {
    await renderPage({ tab: "bogus" });
    expect(screen.getByRole("link", { name: "All" }).getAttribute("aria-current")).toBe("page");
    cleanup();
    fetchCommunityPage.mockResolvedValue(communityPage({ settings: { ...DEFAULT_COMMUNITY_SETTINGS, show_groups: false } }));
    await renderPage({ tab: "groups" });
    expect(screen.getByRole("link", { name: "All" }).getAttribute("aria-current")).toBe("page");
    expect(screen.queryByRole("link", { name: "Groups" })).toBeNull();
  });

  it("still opens, on the default heading, with an error box when the backend is down", async () => {
    fetchCommunityPage.mockRejectedValue(new Error("ECONNREFUSED"));
    await renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Learn, publish and work together" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("could not be loaded");
    expect(screen.getByRole("link", { name: "Workshops" })).toBeTruthy();
    expect(screen.getByTestId("footer")).toBeTruthy();
  });
});
