import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { WorkspaceHeader } from "@/components/workspace/workspace-header";
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
  it("is the Data Repository's light header: eyebrow, title, and the section's action", () => {
    render(<WorkspaceHeader section="drafts" />);
    expect(screen.getByText("Workspace")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Snapshot drafts" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "New snapshot draft" }).getAttribute("href")).toBe("/workspace/new");
    expect(links().find((a) => a.getAttribute("aria-current"))?.textContent).toBe("Snapshot drafts");
  });

  it("says one short line for Snapshots & Inputs, and has no action there", () => {
    render(<WorkspaceHeader section="data" />);
    expect(screen.getByRole("heading", { level: 1, name: "Snapshots & Inputs" })).toBeTruthy();
    expect(screen.getByText(/What you published/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "New snapshot draft" })).toBeNull();
    expect(links().find((a) => a.getAttribute("aria-current"))?.textContent).toBe("Snapshots & Inputs");
  });

  it("has no dark gradient", () => {
    const { container } = render(<WorkspaceHeader section="drafts" />);
    expect(container.innerHTML).not.toContain("gradient");
    expect(container.innerHTML).not.toContain("text-white");
  });
});
