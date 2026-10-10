import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { TutorialsSection } from "./tutorials-section";
import { tutorialCard } from "./community.fixtures";

afterEach(cleanup);

const THREE = [
  tutorialCard(),
  tutorialCard({ id: "t-2", slug: "open-zarr", title: "Open ZARR inputs", kind: "notebook", level: "intermediate", minutes: 15, has_body: false, url: "https://example.org/nb.ipynb", snippet: "" }),
  tutorialCard({ id: "t-3", slug: "no-link", title: "A tutorial with no link", level: "advanced", has_body: false, url: null, minutes: null }),
];

function card(title: string) {
  return screen.getByRole("heading", { name: title }).closest("article") as HTMLElement;
}

describe("TutorialsSection", () => {
  it("shows a card per tutorial with its kind, length, snippet, level, title and summary", () => {
    render(<TutorialsSection tutorials={THREE} />);
    expect(screen.getAllByRole("article")).toHaveLength(3);
    const first = within(card("Run your first snapshot"));
    expect(first.getByText("GATEWAY")).toBeTruthy();
    expect(first.getByText("20 min")).toBeTruthy();
    expect(first.getByText(/Workspace → New snapshot/)).toBeTruthy();
    expect(first.getByText("Beginner")).toBeTruthy();
    expect(first.getByText(/Start from the WBM/)).toBeTruthy();
  });

  it("leaves out the length and the snippet when a tutorial has none", () => {
    render(<TutorialsSection tutorials={THREE} />);
    const zarr = within(card("Open ZARR inputs"));
    expect(zarr.getByText("NOTEBOOK")).toBeTruthy();
    expect(zarr.queryByText(/min$/, { selector: "span" })).toBeTruthy(); // 15 min
    expect(card("Open ZARR inputs").querySelector("code")).toBeNull();
    expect(card("A tutorial with no link").textContent).not.toMatch(/min\b/);
  });

  it("links a tutorial with a body to its own page, with the default label for its kind", () => {
    render(<TutorialsSection tutorials={THREE} />);
    const a = within(card("Run your first snapshot")).getByRole("link", { name: "Start tutorial" });
    expect(a.getAttribute("href")).toBe("/community/tutorials/run-your-first-snapshot");
    expect(a.getAttribute("target")).toBeNull();
  });

  it("links one with no body to its url, in a new tab, with the notebook label", () => {
    render(<TutorialsSection tutorials={THREE} />);
    const a = within(card("Open ZARR inputs")).getByRole("link", { name: /Open notebook/ });
    expect(a.getAttribute("href")).toBe("https://example.org/nb.ipynb");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("uses the admin's action label", () => {
    render(<TutorialsSection tutorials={[tutorialCard({ action_label: "Begin" })]} />);
    expect(screen.getByRole("link", { name: "Begin" })).toBeTruthy();
  });

  it("has no link at all on a card with neither a body nor a url", () => {
    render(<TutorialsSection tutorials={THREE} />);
    expect(within(card("A tutorial with no link")).queryByRole("link")).toBeNull();
  });

  it("filters by level, and All brings every card back", () => {
    render(<TutorialsSection tutorials={THREE} />);
    const group = screen.getByRole("group", { name: "Filter tutorials by level" });
    const pill = (name: string) => within(group).getByRole("button", { name });
    expect(pill("All").getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(pill("Intermediate"));
    expect(pill("Intermediate").getAttribute("aria-pressed")).toBe("true");
    expect(pill("All").getAttribute("aria-pressed")).toBe("false");
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Open ZARR inputs" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("1 tutorial");

    fireEvent.click(pill("Advanced"));
    expect(screen.getByRole("heading", { name: "A tutorial with no link" })).toBeTruthy();

    fireEvent.click(pill("All"));
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(screen.getByRole("status").textContent).toBe("3 tutorials");
  });

  it("offers only the levels that exist, and no filter for a single level", () => {
    render(<TutorialsSection tutorials={[THREE[0], tutorialCard({ id: "t-9", slug: "b", title: "B", level: "advanced" })]} />);
    const group = screen.getByRole("group", { name: "Filter tutorials by level" });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["All", "Beginner", "Advanced"]);
    cleanup();
    render(<TutorialsSection tutorials={[THREE[0]]} />);
    expect(screen.queryByRole("group")).toBeNull();
  });
});
