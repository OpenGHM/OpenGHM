import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ExecutionCard } from "./execution-card";
import { fakeDataset } from "@/lib/workspace/fixtures";

afterEach(cleanup);

describe("ExecutionCard", () => {
  const dataset = fakeDataset();

  it("names the WBM code beside the container, and prints the whole tree hash", () => {
    render(<ExecutionCard uses={dataset.uses} runtime={dataset.runtime} />);

    const term = (label: string) => screen.getByText(label).parentElement!;
    expect(term("WBM Code").textContent).toContain("wbm 23.9.0");
    expect(term("Code Tree Hash").textContent).toContain(dataset.uses.modelCode.treeHash);
    expect(dataset.uses.modelCode.treeHash).toHaveLength(64);
    expect(term("Container Image").textContent).toContain("wbm:2.0.0");
  });

  it("does not take the container's version for the code's", () => {
    render(<ExecutionCard uses={dataset.uses} runtime={dataset.runtime} />);

    expect(screen.getByText("WBM Code").parentElement!.textContent).not.toContain(dataset.uses.container.version);
  });

  it("says the cores and walltime are how the published run was executed", () => {
    render(<ExecutionCard uses={dataset.uses} runtime={dataset.runtime} />);

    expect(screen.getByRole("heading", { name: "How this run was executed" })).toBeTruthy();
    expect(screen.getByText("Cores")).toBeTruthy();
  });

  it("shows no chip or sentence for current code, nor for code whose state is not known", () => {
    const { container, rerender } = render(<ExecutionCard uses={dataset.uses} runtime={dataset.runtime} codeState="current" />);
    expect(container.querySelector("[data-state]")).toBeNull();
    rerender(<ExecutionCard uses={dataset.uses} runtime={dataset.runtime} />);
    expect(container.querySelector("[data-state]")).toBeNull();
    expect(screen.queryByText(/withdrawn|Legacy/)).toBeNull();
  });

  it("puts a Legacy chip beside the code's version and says what it means", () => {
    render(<ExecutionCard uses={dataset.uses} runtime={dataset.runtime} codeState="legacy" />);
    const code = screen.getByText("WBM Code").parentElement!;
    expect(code.querySelector("[data-state='legacy']")).not.toBeNull();
    // Written out once: the chip does not read it again.
    expect(screen.getAllByText("Legacy: runs as published; no new snapshot starts from it.", { selector: "p" })).toHaveLength(1);
    expect(screen.getAllByText(/no new snapshot starts from it/)).toHaveLength(1);
  });

  it("says why a withdrawn version was withdrawn", () => {
    render(
      <ExecutionCard uses={dataset.uses} runtime={dataset.runtime} codeState="withdrawn" codeReason="wrong evaporation constant" />
    );
    expect(screen.getByText(/withdrawn: wrong evaporation constant/, { selector: "p" })).toBeTruthy();
    expect(screen.getByText("Withdrawn").className).toContain("text-hero-attention-text");
  });

  it.each([
    ["mismatch", "Code mismatch", /does not match/],
    ["unlisted", "Not listed", /not in the list of published WBM code versions/],
  ] as const)("warns for %s code", (codeState, label, sentence) => {
    render(<ExecutionCard uses={dataset.uses} runtime={dataset.runtime} codeState={codeState} />);
    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByText(sentence, { selector: "p" })).toBeTruthy();
  });
});
