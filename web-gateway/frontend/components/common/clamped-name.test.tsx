import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ClampedName, clampClass } from "@/components/common/clamped-name";

afterEach(cleanup);

const PAPER =
  "WBM v1.0.0 Wyoming_tracking simulation for 'Water balance model (WBM) v.1.0.0: a scalable gridded global hydrologic model with water-tracking functionality': [Wyoming] [2000-2009]";

describe("clampClass", () => {
  it.each([
    [1, "truncate"],
    [2, "line-clamp-2"],
    [3, "line-clamp-3"],
    [4, "line-clamp-4"],
  ] as const)("keeps %i line(s) with %s", (lines, cls) => {
    expect(clampClass(lines)).toContain(cls);
  });

  it("lets the element shrink and breaks an unbroken token, for every line count", () => {
    for (const lines of [1, 2, 3, 4] as const) {
      const cls = clampClass(lines);
      expect(cls).toContain("min-w-0");
      expect(cls).toContain("[overflow-wrap:anywhere]");
    }
  });

  it("is block-level for one line, where `truncate` alone would not apply to an inline element", () => {
    expect(clampClass(1).split(" ")).toContain("block");
  });
});

describe("ClampedName", () => {
  it("keeps the whole name in the text and in the title", () => {
    render(<ClampedName lines={2}>{PAPER}</ClampedName>);
    const el = screen.getByText(PAPER);
    expect(el.textContent).toBe(PAPER);
    expect(el.getAttribute("title")).toBe(PAPER);
    expect(el.className).toContain("line-clamp-2");
  });

  it("renders the element it is asked for, with an id and extra classes", () => {
    render(
      <ClampedName as="p" lines={1} id="x" className="text-xs">
        Global_tracking
      </ClampedName>
    );
    const el = screen.getByText("Global_tracking");
    expect(el.tagName).toBe("P");
    expect(el.id).toBe("x");
    expect(el.className).toContain("text-xs");
    expect(el.className).toContain("truncate");
  });

  it("takes an explicit title, for children that are not text", () => {
    render(
      <ClampedName as="h3" lines={3} title="Whole name">
        <a href="/x">Whole name</a>
      </ClampedName>
    );
    expect(screen.getByRole("heading", { level: 3 }).getAttribute("title")).toBe("Whole name");
  });

  it("leaves the title off when asked, for a parent that carries it", () => {
    render(
      <ClampedName lines={2} title={false}>
        A name
      </ClampedName>
    );
    expect(screen.getByText("A name").hasAttribute("title")).toBe(false);
  });
});
