import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { WbmCodeChip } from "./wbm-code-chip";
import type { CodeState } from "@/lib/repository/types";

afterEach(cleanup);

describe("WbmCodeChip", () => {
  it.each<CodeState>(["current", "unknown"])("shows nothing for %s", (state) => {
    const { container } = render(<WbmCodeChip state={state} />);
    expect(container.innerHTML).toBe("");
  });

  it("is a neutral pill for legacy code, with its sentence as hover text and read out", () => {
    const { container } = render(<WbmCodeChip state="legacy" />);
    const chip = container.querySelector("[data-state='legacy']") as HTMLElement;
    expect(chip.firstChild?.textContent).toBe("Legacy");
    expect(chip.title).toBe("Legacy: runs as published; no new snapshot starts from it.");
    expect(chip.textContent).toContain("no new snapshot starts from it");
    expect(chip.className).toContain("bg-muted");
    expect(chip.className).not.toContain("warning");
  });

  it("is a warning for withdrawn code, and carries the reason", () => {
    const { container } = render(<WbmCodeChip state="withdrawn" reason="wrong evaporation constant" />);
    const chip = container.querySelector("[data-state='withdrawn']") as HTMLElement;
    expect(chip.firstChild?.textContent).toBe("Withdrawn");
    expect(chip.title).toContain("wrong evaporation constant");
    expect(chip.className).toContain("text-warning");
  });

  it("is a warning for mismatched and unlisted code", () => {
    render(
      <>
        <WbmCodeChip state="mismatch" />
        <WbmCodeChip state="unlisted" />
      </>
    );
    expect(screen.getByText("Code mismatch").className).toContain("text-warning");
    expect(screen.getByText("Not listed").className).toContain("text-warning");
    expect(screen.getByText("Code mismatch").title).toContain("does not match");
    expect(screen.getByText("Not listed").title).toContain("not in the list of published WBM code versions");
  });

  it("uses the band's amber on the navy panels, and says nothing aloud when the page writes the sentence out", () => {
    const { container } = render(<WbmCodeChip state="withdrawn" tone="dark" spoken={false} />);
    const chip = container.querySelector("[data-state='withdrawn']") as HTMLElement;
    expect(chip.className).toContain("text-hero-attention-text");
    expect(chip.querySelector(".sr-only")).toBeNull();
  });
});
