import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { WorkspaceHeader } from "@/components/workspace/workspace-header";
import { WorkspaceSections } from "@/components/workspace/workspace-sections";

const status = { pending: false };
// The site header reads the session, which these tests have no provider for.
vi.mock("@/components/landing/header", () => ({ Header: () => null }));
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
  it("is two links, Snapshot drafts then Snapshots & Inputs, to their pages", () => {
    render(<WorkspaceSections active="drafts" />);
    expect(links().map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Snapshot drafts", "/workspace"],
      ["Snapshots & Inputs", "/workspace/data"],
    ]);
  });

  it.each([
    ["drafts", "Snapshot drafts"],
    ["data", "Snapshots & Inputs"],
  ] as const)("marks %s as the current page, and only that one", (section, label) => {
    render(<WorkspaceSections active={section} />);
    const current = links().filter((a) => a.getAttribute("aria-current") === "page");
    expect(current.map((a) => a.textContent)).toEqual([label]);
  });

  it("keeps every target 40 px tall", () => {
    render(<WorkspaceSections active="drafts" />);
    for (const a of links()) expect(a.className).toContain("min-h-10");
  });
});

describe("the Workspace section switch while a section loads", () => {
  it("shows a delayed spinner in the link that was clicked", () => {
    status.pending = true;
    render(<WorkspaceSections active="drafts" />);
    for (const a of links()) {
      expect(a.querySelector('[data-slot="link-pending"]')?.className).toContain("reveal-delayed");
    }
  });
});

describe("the Workspace header", () => {
  it("is a navy band: eyebrow, title, and the section's action", () => {
    render(<WorkspaceHeader section="drafts" />);
    expect(screen.getByText("Workspace")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Snapshot drafts" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "New snapshot" }).getAttribute("href")).toBe("/workspace/new");
    expect(links().find((a) => a.getAttribute("aria-current"))?.textContent).toBe("Snapshot drafts");
  });

  it("says one short line for Snapshots & Inputs, and has no action there", () => {
    render(<WorkspaceHeader section="data" />);
    expect(screen.getByRole("heading", { level: 1, name: "Snapshots & Inputs" })).toBeTruthy();
    expect(screen.getByText(/What you published/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "New snapshot" })).toBeNull();
    expect(links().find((a) => a.getAttribute("aria-current"))?.textContent).toBe("Snapshots & Inputs");
  });

  it.each(["drafts", "data"] as const)("is the page's navy band, as the repository's is (%s)", (section) => {
    const { container } = render(<WorkspaceHeader section={section} />);
    expect((container.firstElementChild as HTMLElement).className).toContain("bg-hero");
  });

  it("draws the section switch as the site header's pill, the current section the white segment", () => {
    render(<WorkspaceHeader section="data" />);
    const [drafts, data] = links();
    expect(data.classList.contains("bg-white")).toBe(true);
    expect(drafts.classList.contains("bg-white")).toBe(false);
  });
});
