import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Footer } from "@/components/landing/footer";
import { SiteFeaturesProvider } from "@/components/site-features";

afterEach(cleanup);

describe("the footer", () => {
  it("lays the columns out for a phone first and widens from there", () => {
    const { container } = render(<Footer />);
    const grid = container.querySelector("footer .grid");
    expect(grid?.className).toContain("grid-cols-2");
    expect(grid?.className).toContain("lg:grid-cols-[2fr_1fr_1fr]");
    // The brand block spans the full row on a phone, and is one column from lg.
    const brand = grid?.firstElementChild;
    expect(brand?.className).toContain("col-span-2");
    expect(brand?.className).toContain("lg:col-span-1");
  });

  it("lists the two link columns", () => {
    render(<Footer />);
    for (const title of ["Platform", "Community"]) {
      expect(screen.getByRole("heading", { name: title })).toBeTruthy();
    }
    expect(screen.queryByRole("heading", { name: "Legal" })).toBeNull();
  });

  it("links only to pages that exist", () => {
    render(<Footer />);
    const hrefs = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"))
      .filter((h) => !h?.startsWith("https://"));
    expect(hrefs).toEqual(["/repository", "/workspace", "/community?tab=workshops", "/news"]);
  });
});

describe("the footer with the Workspace off", () => {
  it("marks Workspace Coming soon and does not link to it", () => {
    render(
      <SiteFeaturesProvider features={{ workspace: false }}>
        <Footer />
      </SiteFeaturesProvider>
    );
    expect(screen.queryByRole("link", { name: "Workspace" })).toBeNull();
    expect(screen.getByText("Workspace").textContent).toContain("Coming soon");
  });
});
