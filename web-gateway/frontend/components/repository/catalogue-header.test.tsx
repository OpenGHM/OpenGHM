import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// The band carries the site header, which reads the session and the path.
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null }), signOut: vi.fn() }));
vi.mock("@/lib/auth-actions", () => ({ revokeSession: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/repository" }));

import { CatalogueHeader } from "./catalogue-header";
import { CatalogueSearchProvider } from "./catalogue-search";

afterEach(cleanup);

describe("CatalogueHeader", () => {
  function renderHeader() {
    return render(
      <CatalogueSearchProvider query="" onQueryChange={vi.fn()}>
        <CatalogueHeader />
      </CatalogueSearchProvider>
    );
  }

  it("has the eyebrow and the one h1", () => {
    renderHeader();
    expect(screen.getByRole("heading", { level: 1, name: "Find model snapshots and inputs for hydrologic research." })).toBeTruthy();
    const eyebrow = screen.getAllByText("Data Repository").find((el) => el.tagName === "P");
    expect(eyebrow?.className).toContain("uppercase");
    expect(eyebrow?.className).toContain("font-mono");
  });

  it("carries the search box in the band", () => {
    renderHeader();
    expect(screen.getByRole("search")).toBeTruthy();
    expect(screen.getByRole("searchbox", { name: "Search the repository" })).toBeTruthy();
  });
});
