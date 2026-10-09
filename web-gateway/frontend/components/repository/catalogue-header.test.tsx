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

  it("has the eyebrow, the one h1 and the subtitle", () => {
    renderHeader();
    expect(screen.getByRole("heading", { level: 1, name: "Data Repository" })).toBeTruthy();
    expect(screen.getByText("Repository").className).toContain("uppercase");
    expect(screen.getByText("Repository").className).toContain("font-mono");
    expect(screen.getByText("Model snapshots and inputs shared by the OpenGHM community")).toBeTruthy();
  });

  it("carries the search box in the band", () => {
    renderHeader();
    expect(screen.getByRole("search")).toBeTruthy();
    expect(screen.getByRole("searchbox", { name: "Search the repository" })).toBeTruthy();
  });
});
