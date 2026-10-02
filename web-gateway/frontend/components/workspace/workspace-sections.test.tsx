import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { WorkspaceHero } from "@/components/workspace/workspace-hero";
import { WorkspaceSections } from "@/components/workspace/workspace-sections";

const status = { pending: false };
vi.mock("next/link", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/link")>()),
  useLinkStatus: () => status,
}));

afterEach(() => {
  cleanup();
  status.pending = false;
});

function links() {
  return within(screen.getByRole("navigation", { name: "Workspace sections" })).getAllByRole("link");
}

describe("the Workspace section switch", () => {
  it("is two links, Simulations then Snapshots & Inputs, to their pages", () => {
    render(<WorkspaceSections active="simulations" />);
    expect(links().map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Simulations", "/workspace"],
      ["Snapshots & Inputs", "/workspace/data"],
    ]);
  });

  it.each([
    ["simulations", "Simulations"],
    ["data", "Snapshots & Inputs"],
  ] as const)("marks %s as the current page, and only that one", (section, label) => {
    render(<WorkspaceSections active={section} />);
    const current = links().filter((a) => a.getAttribute("aria-current") === "page");
    expect(current.map((a) => a.textContent)).toEqual([label]);
  });

  it("keeps every target 40 px tall", () => {
    render(<WorkspaceSections active="simulations" />);
    for (const a of links()) expect(a.className).toContain("min-h-10");
  });
});

describe("the Workspace section switch while a section loads", () => {
  it("shows a delayed spinner in the link that was clicked", () => {
    status.pending = true;
    render(<WorkspaceSections active="simulations" />);
    for (const a of links()) {
      expect(a.querySelector('[data-slot="link-pending"]')?.className).toContain("reveal-delayed");
    }
  });
});

describe("the Workspace hero", () => {
  it("says what the Simulations section says today, with its action", () => {
    render(<WorkspaceHero section="simulations" />);
    expect(screen.getByText("Workspace · Private & unpublished")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "My Simulations" })).toBeTruthy();
    expect(
      screen.getByText("Working configurations only you can see. Nothing here is a published model snapshot.")
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "New Simulation" }).getAttribute("href")).toBe("/workspace/new");
    expect(links().find((a) => a.getAttribute("aria-current"))?.textContent).toBe("Simulations");
  });

  it("says what the Snapshots & Inputs section says, with no action", () => {
    render(<WorkspaceHero section="data" />);
    expect(screen.getByText("Workspace · Immutable records")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "My Snapshots & Inputs" })).toBeTruthy();
    expect(
      screen.getByText(
        "Snapshots and model inputs you published. Their contents never change, and a correction is a new version; visibility decides who can find them."
      )
    ).toBeTruthy();
    expect(screen.queryByRole("link", { name: "New Simulation" })).toBeNull();
    expect(links().find((a) => a.getAttribute("aria-current"))?.textContent).toBe("Snapshots & Inputs");
  });
});
