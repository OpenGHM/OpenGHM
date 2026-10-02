import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DraftStep } from "@/lib/workspace/draft-wizard";

import { DraftProgress } from "@/components/workspace/draft-progress";

afterEach(cleanup);

function strip(current: DraftStep, problemSteps: DraftStep[] = []) {
  const onSelectStep = vi.fn();
  render(
    <DraftProgress
      jobId="job-1"
      current={current}
      snapshotTitle="Global WBM"
      problemSteps={problemSteps}
      onSelectStep={onSelectStep}
    />
  );
  return { onSelectStep };
}

describe("DraftProgress", () => {
  it("shows step 1 as done and not clickable, with the snapshot it started from", () => {
    strip("run");
    expect(screen.getByText("Start from")).toBeTruthy();
    expect(screen.getByText("Started from: Global WBM")).toBeTruthy();
    // The only links are the three steps of the draft.
    expect(screen.getAllByRole("link").map((l) => l.textContent)).toEqual([
      "2Model & input",
      "3Run settings",
      "4Review & submit",
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
    expect(screen.getByRole("link", { name: /Model & input/ }).getAttribute("href")).toBe(
      "/workspace/job-1?step=model"
    );
    expect(screen.getByRole("link", { name: /Run settings/ }).getAttribute("href")).toBe(
      "/workspace/job-1?step=run"
    );
    expect(screen.getByRole("link", { name: /Review & submit/ }).getAttribute("href")).toBe(
      "/workspace/job-1?step=review"
    );
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
    strip("model", ["run", "review"]);
    expect(screen.getByRole("link", { name: /Model & input/ }).textContent).not.toContain("needs attention");
    expect(screen.getByRole("link", { name: /Run settings.*needs attention/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Review & submit.*needs attention/ })).toBeTruthy();
    expect(document.querySelectorAll(".bg-amber-300")).toHaveLength(2);
  });

  it("has no dot when nothing needs attention", () => {
    strip("model");
    expect(document.querySelectorAll(".bg-amber-300")).toHaveLength(0);
    expect(screen.queryByText(/needs attention/)).toBeNull();
  });
});
