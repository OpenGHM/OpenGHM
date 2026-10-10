import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { CommunityTabs } from "./community-tabs";

afterEach(cleanup);

describe("CommunityTabs", () => {
  it("lists All, Workshops, Tutorials, Publications and Groups as links driven by ?tab=", () => {
    render(<CommunityTabs active="all" showGroups />);
    const nav = screen.getByRole("navigation", { name: "Community sections" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual(["All", "Workshops", "Tutorials", "Publications", "Groups"]);
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/community",
      "/community?tab=workshops",
      "/community?tab=tutorials",
      "/community?tab=publications",
      "/community?tab=groups",
    ]);
  });

  it("marks the current one, and only that", () => {
    render(<CommunityTabs active="tutorials" showGroups />);
    const current = screen.getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page");
    expect(current.map((a) => a.textContent)).toEqual(["Tutorials"]);
    expect(current[0].className).toContain("bg-white");
  });

  it("leaves Groups out when the groups band is off", () => {
    render(<CommunityTabs active="all" showGroups={false} />);
    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual(["All", "Workshops", "Tutorials", "Publications"]);
  });
});
