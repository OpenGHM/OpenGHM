import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { tutorialCard } from "@/components/community/community.fixtures";
import type { Tutorial } from "@/lib/community/types";

const { getTutorial } = vi.hoisted(() => ({ getTutorial: vi.fn() }));
vi.mock("@/lib/community/data", () => ({ getTutorial }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/components/landing/header", () => ({ Header: () => <header /> }));
vi.mock("@/components/landing/footer", () => ({ Footer: () => <footer /> }));

import TutorialPage, { generateMetadata } from "./page";

function tutorial(over: Partial<Tutorial> = {}): Tutorial {
  const { has_body: _unused, ...rest } = tutorialCard();
  void _unused;
  return {
    ...rest,
    body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Step one: open the Workspace." }] }] },
    ...over,
  };
}

beforeEach(() => {
  getTutorial.mockResolvedValue(tutorial());
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const params = (slug = "run-your-first-snapshot") => ({ params: Promise.resolve({ slug }) });

describe("a tutorial's page", () => {
  it("shows the kind, level, length, title, summary and body", async () => {
    render(await TutorialPage(params()));
    const crumbs = within(screen.getByRole("navigation", { name: "Breadcrumb" }));
    expect(crumbs.getByRole("link", { name: "Tutorials" }).getAttribute("href")).toBe("/community?tab=tutorials");
    expect(screen.getByText("GATEWAY")).toBeTruthy();
    expect(screen.getByText("Beginner")).toBeTruthy();
    expect(screen.getByText("20 min")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Run your first snapshot" })).toBeTruthy();
    expect(screen.getByText(/Start from the WBM/)).toBeTruthy();
    expect(screen.getByText("Step one: open the Workspace.")).toBeTruthy();
  });

  it("has a button to the url, labelled by its kind unless the admin wrote one", async () => {
    getTutorial.mockResolvedValue(tutorial({ kind: "notebook", url: "https://example.org/nb.ipynb" }));
    render(await TutorialPage(params()));
    const a = screen.getByRole("link", { name: /Open notebook/ });
    expect(a.getAttribute("href")).toBe("https://example.org/nb.ipynb");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("has no button without a url, or with one that is not safe", async () => {
    render(await TutorialPage(params()));
    expect(screen.queryByRole("link", { name: /Start tutorial/ })).toBeNull();
    cleanup();
    getTutorial.mockResolvedValue(tutorial({ url: "javascript:alert(1)" }));
    render(await TutorialPage(params()));
    expect(screen.queryByRole("link", { name: /Start tutorial/ })).toBeNull();
  });

  it("says so when the tutorial has no written steps", async () => {
    getTutorial.mockResolvedValue(tutorial({ body: null }));
    render(await TutorialPage(params()));
    expect(screen.getByText(/no written steps yet/)).toBeTruthy();
  });

  it("is a 404 when there is no such tutorial", async () => {
    getTutorial.mockResolvedValue(null);
    await expect(TutorialPage(params("nope"))).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("takes its title and summary for the metadata", async () => {
    await expect(generateMetadata(params())).resolves.toEqual({
      title: "Run your first snapshot | OpenGHM",
      description: "Start from the WBM v2.0.0 CONUS tutorial and submit it to Anvil.",
    });
    getTutorial.mockResolvedValue(null);
    await expect(generateMetadata(params())).resolves.toEqual({ title: "Tutorial | OpenGHM" });
  });
});
