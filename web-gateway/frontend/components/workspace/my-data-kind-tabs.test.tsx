import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MyDataKindTabs } from "./my-data-kind-tabs";

const COUNTS = { all: 3, snapshot: 2, "model-input": 1 };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function links() {
  return within(screen.getByRole("navigation", { name: "Filter by type" })).getAllByRole("link");
}

describe("the kind tabs", () => {
  it("are All, Model Snapshots and Model Inputs, each with its count and its own URL", () => {
    render(<MyDataKindTabs active="all" counts={COUNTS} />);
    expect(links().map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["All3", "/workspace/data"],
      ["Model Snapshots2", "/workspace/data?kind=snapshot"],
      ["Model Inputs1", "/workspace/data?kind=model-input"],
    ]);
  });

  it("mark the selected one with aria-current, and only that one", () => {
    render(<MyDataKindTabs active="model-input" counts={COUNTS} />);
    const current = links().filter((a) => a.getAttribute("aria-current") === "page");
    expect(current.map((a) => a.textContent)).toEqual(["Model Inputs1"]);
  });

  it("keep every target 40 px tall", () => {
    render(<MyDataKindTabs active="all" counts={COUNTS} />);
    for (const a of links()) expect(a.className).toContain("min-h-10");
  });

  it("push the URL on a plain click, without navigating", () => {
    const push = vi.spyOn(window.history, "pushState");
    render(<MyDataKindTabs active="all" counts={COUNTS} />);
    const notPrevented = fireEvent.click(links()[1]);
    expect(notPrevented).toBe(false);
    expect(push).toHaveBeenCalledWith(null, "", "/workspace/data?kind=snapshot");
  });

  it("leave a click with a modifier to the browser", () => {
    const push = vi.spyOn(window.history, "pushState");
    // What the link's own handler left of the click when it bubbled up here;
    // then stop jsdom from "navigating".
    const seen: boolean[] = [];
    render(
      <div
        onClick={(e) => {
          seen.push(e.defaultPrevented);
          e.preventDefault();
        }}
      >
        <MyDataKindTabs active="all" counts={COUNTS} />
      </div>
    );
    fireEvent.click(links()[1], { ctrlKey: true });
    fireEvent.click(links()[2], { metaKey: true });
    expect(seen).toEqual([false, false]);
    expect(push).not.toHaveBeenCalled();
  });
});
