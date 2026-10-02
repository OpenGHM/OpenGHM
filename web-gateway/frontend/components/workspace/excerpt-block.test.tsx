import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ExcerptBlock } from "@/components/workspace/excerpt-block";
import { SHORT_EXCERPT_CHARS, SHORT_EXCERPT_LINES } from "@/lib/workspace/log-lines";

afterEach(cleanup);

const SHORT = "error: Detected 1 oom_kill event in StepId=1.batch. Some of the step tasks have been OOM Killed.";
const MANY_LINES = Array.from({ length: SHORT_EXCERPT_LINES + 1 }, (_, i) => `line ${i + 1}`).join("\n");
const LONG_LINE = "x".repeat(SHORT_EXCERPT_CHARS + 1);

describe("ExcerptBlock", () => {
  it("is open when the excerpt is short, and says so", () => {
    render(<ExcerptBlock excerpt={SHORT} />);
    const toggle = screen.getByRole("button", { name: "Log excerpt" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(SHORT)).toBeTruthy();
    expect(screen.queryByText("Show log excerpt")).toBeNull();
  });

  it.each([
    ["too many lines", MANY_LINES],
    ["too many characters", LONG_LINE],
  ])("is collapsed behind Show log excerpt when it has %s", (_, excerpt) => {
    const { container } = render(<ExcerptBlock excerpt={excerpt} />);
    const toggle = screen.getByRole("button", { name: "Show log excerpt" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector("pre")).toBeNull();

    fireEvent.click(toggle);
    expect(container.querySelector("pre")?.textContent).toBe(excerpt);
    expect(screen.getByRole("button", { name: "Log excerpt" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("can be closed when it opened by itself", () => {
    const { container } = render(<ExcerptBlock excerpt={SHORT} />);
    fireEvent.click(screen.getByRole("button", { name: "Log excerpt" }));
    expect(container.querySelector("pre")).toBeNull();
    expect(screen.getByRole("button", { name: "Show log excerpt" })).toBeTruthy();
  });

  it.each([SHORT, MANY_LINES])("keeps the Copy button either way", (excerpt) => {
    render(<ExcerptBlock excerpt={excerpt} />);
    expect(screen.getByRole("button", { name: /copy/i })).toBeTruthy();
  });
});
