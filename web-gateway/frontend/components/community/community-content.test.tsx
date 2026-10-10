import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

vi.mock("@/lib/community/actions", () => ({ setGroupInterest: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { CommunityContent, communityLayout } from "./community-content";
import { communityPage } from "./community.fixtures";
import { DEFAULT_COMMUNITY_SETTINGS } from "@/lib/community/settings";

afterEach(cleanup);

const render_ = (over: Partial<Parameters<typeof CommunityContent>[0]> = {}) =>
  render(<CommunityContent page={communityPage()} tab="all" signedIn={false} here="/community" {...over} />);

const headings = () => screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);

describe("CommunityContent on the All tab", () => {
  it("shows every section with something in it, in order", () => {
    render_();
    expect(headings()).toEqual(["Workshops", "Tutorials", "Publications", "Discussion groups"]);
  });

  it("hides a section that has no published items", () => {
    render_({ page: communityPage({ workshops: [], publications: [] }) });
    expect(headings()).toEqual(["Tutorials", "Discussion groups"]);
  });

  it("hides the groups band when the settings switch it off", () => {
    render_({ page: communityPage({ settings: { ...DEFAULT_COMMUNITY_SETTINGS, show_groups: false } }) });
    expect(headings()).toEqual(["Workshops", "Tutorials", "Publications"]);
    expect(screen.queryByText("Coming soon · Preview")).toBeNull();
  });

  it("says calmly that nothing is published when there is nothing and groups are off", () => {
    render_({
      page: communityPage({
        workshops: [],
        tutorials: [],
        publications: [],
        settings: { ...DEFAULT_COMMUNITY_SETTINGS, show_groups: false },
      }),
    });
    expect(screen.getByText(/Nothing is published here yet/)).toBeTruthy();
  });

  it("shows an error box in place of the content when the backend did not answer, with a reload link", () => {
    render_({ page: communityPage({ workshops: [], tutorials: [], publications: [] }), failed: true });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("could not be loaded");
    expect(within(alert).getByRole("link", { name: "Reload the page" }).getAttribute("href")).toBe("/community");
    expect(screen.queryByText(/Nothing is published here yet/)).toBeNull();
  });
});

describe("CommunityContent on a tab of its own", () => {
  it("shows only that section", () => {
    render_({ tab: "tutorials" });
    expect(headings()).toEqual(["Tutorials"]);
  });

  it("says so when that section has nothing yet", () => {
    render_({ tab: "publications", page: communityPage({ publications: [] }) });
    expect(screen.getByRole("heading", { name: "Publications" })).toBeTruthy();
    expect(screen.getByText("No publications are listed yet.")).toBeTruthy();
  });

  it("shows the workshops empty state on the Workshops tab", () => {
    render_({ tab: "workshops", page: communityPage({ workshops: [] }) });
    expect(screen.getByText(/No workshops are listed yet/)).toBeTruthy();
  });

  it("shows the groups band on the Groups tab", () => {
    render_({ tab: "groups" });
    expect(headings()).toEqual(["Discussion groups"]);
  });
});

describe("the groups band", () => {
  it("shows the admin's heading and intro, the Coming soon pill and the illustration, which no one can focus or read", () => {
    const { container } = render_({
      tab: "groups",
      page: communityPage({
        settings: { ...DEFAULT_COMMUNITY_SETTINGS, groups_title: "Study groups", groups_intro: "Join a group for your region." },
      }),
    });
    expect(screen.getByRole("heading", { name: "Study groups" })).toBeTruthy();
    expect(screen.getByText("Join a group for your region.")).toBeTruthy();
    expect(screen.getByText("Coming soon · Preview")).toBeTruthy();
    const preview = container.querySelector("[aria-hidden='true'][inert]");
    expect(preview).not.toBeNull();
    expect(preview?.textContent).toContain("WBM CONUS");
    // The only control that is not inside the illustration is the notify link.
    const outside = screen
      .getAllByRole("link")
      .filter((el) => !preview?.contains(el));
    expect(outside.map((a) => a.textContent)).toEqual(["Notify me when groups open"]);
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("links a signed-out visitor to sign in and back", () => {
    render_({ tab: "groups", here: "/community?tab=groups" });
    expect(screen.getByRole("link", { name: "Notify me when groups open" }).getAttribute("href")).toBe(
      "/auth/signin?callbackUrl=%2Fcommunity%3Ftab%3Dgroups",
    );
    expect(screen.getByText("You will be asked to sign in.")).toBeTruthy();
  });

  it("shows a signed-in visitor a button, already confirmed when they asked before", () => {
    render_({ tab: "groups", signedIn: true, page: communityPage({ group_interest: true }) });
    expect(screen.getByRole("button", { name: "We will email you ✓" })).toBeTruthy();
    expect(screen.queryByText("You will be asked to sign in.")).toBeNull();
  });
});

describe("communityLayout", () => {
  it("starts with a card whenever Workshops is shown, there is an error or there is nothing", () => {
    expect(communityLayout(communityPage(), "all").startsWithCard).toBe(true);
    expect(communityLayout(communityPage(), "workshops").startsWithCard).toBe(true);
    expect(communityLayout(communityPage({ workshops: [] }), "all", true).startsWithCard).toBe(true);
    const nothing = communityPage({ workshops: [], tutorials: [], publications: [], settings: { ...DEFAULT_COMMUNITY_SETTINGS, show_groups: false } });
    expect(communityLayout(nothing, "all").startsWithCard).toBe(true);
  });

  it("starts below the band when a heading comes first", () => {
    expect(communityLayout(communityPage(), "tutorials").startsWithCard).toBe(false);
    expect(communityLayout(communityPage({ workshops: [] }), "all").startsWithCard).toBe(false);
    expect(communityLayout(communityPage(), "groups").startsWithCard).toBe(false);
  });
});
