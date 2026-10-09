import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { newStepHref, type DraftStep } from "@/lib/workspace/draft-wizard";

import { DraftProgress, StartProgress } from "@/components/workspace/draft-progress";

afterEach(cleanup);

function strip(current: DraftStep, problemSteps: DraftStep[] = []) {
  const onSelectStep = vi.fn();
  render(
    <DraftProgress
      jobId="job-1"
      current={current}
      problemSteps={problemSteps}
      onSelectStep={onSelectStep}
    />
  );
  return { onSelectStep };
}

describe("DraftProgress", () => {
  it("shows step 1 as done and not clickable, and says nothing about what it was", () => {
    strip("run");
    expect(screen.getByText("Start from")).toBeTruthy();
    expect(screen.getByText("(done)")).toBeTruthy();
    expect(screen.queryByText(/Started from/)).toBeNull();
    // The only links are the two steps of the draft.
    expect(screen.getAllByRole("link").map((l) => l.textContent)).toEqual([
      "2Run settings",
      "3Review & submit",
    ]);
    expect(screen.getByText("Start from").closest("a, button")).toBeNull();
  });

  it("marks the current step with aria-current and no other", () => {
    strip("run");
    const current = screen.getAllByRole("link").filter((l) => l.getAttribute("aria-current") === "step");
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toContain("Run settings");
  });

  it("links each step to its URL", () => {
    strip("review");
    expect(screen.getByRole("link", { name: /Run settings/ }).getAttribute("href")).toBe(
      "/workspace/job-1?step=run"
    );
    expect(screen.getByRole("link", { name: /Review & submit/ }).getAttribute("href")).toBe(
      "/workspace/job-1?step=review"
    );
  });

  it("links the steps of a snapshot draft that is not saved yet to /workspace/new/<snapshot>, by hrefFor", () => {
    const onSelectStep = vi.fn();
    render(
      <DraftProgress
        hrefFor={(step) => newStepHref("snap-1", step)}
        current="run"
        problemSteps={[]}
        onSelectStep={onSelectStep}
      />
    );
    expect(screen.getByRole("link", { name: /Run settings/ }).getAttribute("href")).toBe(
      "/workspace/new/snap-1?step=run"
    );
    expect(screen.getByRole("link", { name: /Review & submit/ }).getAttribute("href")).toBe(
      "/workspace/new/snap-1?step=review"
    );
    fireEvent.click(screen.getByRole("link", { name: /Review & submit/ }));
    expect(onSelectStep).toHaveBeenCalledWith("review");
  });

  it("changes step in place on a plain click, and leaves other clicks to the browser", () => {
    const { onSelectStep } = strip("review");
    const link = screen.getByRole("link", { name: /Run settings/ });
    const plain = fireEvent.click(link);
    expect(onSelectStep).toHaveBeenCalledWith("run");
    // preventDefault: the browser does not also follow the href.
    expect(plain).toBe(false);

    onSelectStep.mockClear();
    const modified = fireEvent.click(link, { ctrlKey: true });
    expect(onSelectStep).not.toHaveBeenCalled();
    expect(modified).toBe(true);
  });

  it("puts a dot, and a spoken note, on each step with problems", () => {
    strip("run", ["review"]);
    expect(screen.getByRole("link", { name: /Run settings/ }).textContent).not.toContain("needs attention");
    expect(screen.getByRole("link", { name: /Review & submit.*needs attention/ })).toBeTruthy();
    expect(document.querySelectorAll(".bg-hero-attention")).toHaveLength(1);
  });

  it("has no dot when nothing needs attention", () => {
    strip("run");
    expect(document.querySelectorAll(".bg-hero-attention")).toHaveLength(0);
    expect(screen.queryByText(/needs attention/)).toBeNull();
  });
});

describe("the strip's look", () => {
  it("is a row on the navy band: done steps are a green check, the current one the white pill, the rest outlined", () => {
    const { container } = render(
      <DraftProgress jobId="job-1" current="run" problemSteps={[]} onSelectStep={vi.fn()} />
    );
    expect(container.querySelector("svg.lucide-check")).not.toBeNull();
    expect(screen.getByRole("link", { name: /Run settings/ }).classList.contains("bg-white")).toBe(true);
    expect(screen.getByRole("link", { name: /Review & submit/ }).classList.contains("bg-white")).toBe(false);
    // The done step is a green disc with a check, and a green line leads to the next.
    expect(container.querySelector("svg.lucide-check")?.parentElement?.classList.contains("bg-success")).toBe(true);
    const lines = Array.from(container.querySelectorAll("ol > li[aria-hidden]"));
    expect(lines.map((li) => li.classList.contains("bg-success"))).toEqual([true, false]);
  });
});

describe("StartProgress", () => {
  it("shows Start from as the current step and the rest as plain, unclickable steps", () => {
    render(<StartProgress />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.getByText("Start from").closest("[aria-current]")?.getAttribute("aria-current")).toBe("step");
    for (const label of ["Run settings", "Review & submit"]) {
      expect(screen.getByText(label).closest("[aria-current]")).toBeNull();
    }
  });
});
