import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { communityPage } from "@/components/community/community.fixtures";

const { auth, fetchCommunityPage } = vi.hoisted(() => ({ auth: vi.fn(), fetchCommunityPage: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/community/data", async () => ({
  ...(await vi.importActual<typeof import("@/lib/community/data")>("@/lib/community/data")),
  fetchCommunityPage,
}));
vi.mock("@/lib/community/actions", () => ({ setGroupInterest: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
// The Header reads the session through next-auth/react; the page test is about the page.
vi.mock("@/components/landing/header", () => ({ Header: () => <header data-testid="header" /> }));
vi.mock("@/components/landing/footer", () => ({ Footer: () => <footer data-testid="footer" /> }));

import CommunityPage from "./page";
import { DEFAULT_COMMUNITY_SETTINGS } from "@/lib/community/settings";

beforeEach(() => {
  auth.mockResolvedValue(null);
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

  it("sends a signed-out visitor to sign in and back to this very tab", async () => {
    await renderPage({ tab: "groups" });
    expect(screen.getByRole("link", { name: "Notify me when groups open" }).getAttribute("href")).toBe(
      "/auth/signin?callbackUrl=%2Fcommunity%3Ftab%3Dgroups",
    );
  });

  it("gives a signed-in visitor the button, and an expired session counts as signed out", async () => {
    auth.mockResolvedValue({ user: { id: "u1" } });
    fetchCommunityPage.mockResolvedValue(communityPage({ group_interest: true }));
    await renderPage({ tab: "groups" });
    expect(screen.getByRole("button", { name: "We will email you ✓" })).toBeTruthy();
    cleanup();
    auth.mockResolvedValue({ user: { id: "u1" }, error: "RefreshAccessTokenError" });
    await renderPage({ tab: "groups" });
    expect(screen.getByRole("link", { name: "Notify me when groups open" })).toBeTruthy();
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
