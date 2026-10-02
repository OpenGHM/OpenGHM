import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { SaveStatus } from "@/components/workspace/save-status";
import type { SaveState } from "@/lib/workspace/use-draft-autosave";

afterEach(cleanup);

function show(state: SaveState) {
  const onRetry = vi.fn();
  const onGoToField = vi.fn();
  const view = render(<SaveStatus state={state} onRetry={onRetry} onGoToField={onGoToField} />);
  const rerender = (next: SaveState) =>
    view.rerender(<SaveStatus state={next} onRetry={onRetry} onGoToField={onGoToField} />);
  return { ...view, onRetry, onGoToField, rerender };
}

const live = () => screen.getByRole("status");

describe("SaveStatus: the words", () => {
  it("saved: says Saved, with the time of the save", () => {
    const { container } = show({ kind: "saved", at: "2026-10-01T12:00:00.000Z" });
    expect(container.textContent).toContain("Saved");
    expect(container.querySelector("time")?.getAttribute("datetime")).toBe("2026-10-01T12:00:00.000Z");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("saved with no time", () => {
    const { container } = show({ kind: "saved", at: null });
    expect(container.textContent).toContain("Saved");
    expect(container.querySelector("time")).toBeNull();
  });

  it("saving", () => {
    const { container } = show({ kind: "saving" });
    expect(container.textContent).toContain("Saving…");
  });

  it("retrying: says it is trying again, with no button", () => {
    const { container } = show({ kind: "retrying", attempt: 2 });
    expect(container.textContent).toContain("Couldn't save. Retrying…");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("failed: says so, and Retry calls onRetry", () => {
    const { container, onRetry } = show({ kind: "failed", message: "Network down" });
    expect(container.textContent).toContain("Couldn't save");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("refused: names the field to fix, and the link goes to it", () => {
    const { container, onGoToField } = show({
      kind: "refused",
      fields: ["start"],
      message: "A run must start on January 1.",
    });
    expect(container.textContent).toContain("Couldn't save:");
    const link = screen.getByRole("button", { name: "fix Start date" });
    expect(link.getAttribute("title")).toBe("A run must start on January 1.");
    fireEvent.click(link);
    expect(onGoToField).toHaveBeenCalledWith("start");
  });

  it("refused: says how many more there are", () => {
    const { container } = show({ kind: "refused", fields: ["walltime", "cores", "end"], message: "x" });
    expect(screen.getByRole("button", { name: "fix Walltime" })).toBeTruthy();
    expect(container.textContent).toContain("and 2 more");
  });

  it("session expired: says to sign in again", () => {
    const { container } = show({ kind: "session-expired" });
    expect(container.textContent).toContain("Couldn't save: sign in again");
  });

  it("conflict and gone: Not saved (the page's banner says why)", () => {
    const { container, rerender } = show({ kind: "conflict" });
    expect(container.textContent).toContain("Not saved");
    rerender({ kind: "gone" });
    expect(container.textContent).toContain("Not saved");
  });

  it("suspended: says auto-save is off, not that anything failed", () => {
    const { container } = show({ kind: "suspended" });
    expect(container.textContent).toContain("Auto-save is off");
    expect(container.textContent).not.toContain("Couldn't save");
  });
});

describe("SaveStatus: the live region", () => {
  it("is empty and outside the visible text while saving and saved", () => {
    const { rerender } = show({ kind: "saved", at: null });
    expect(live().textContent).toBe("");
    expect(live().className).toContain("sr-only");
    rerender({ kind: "saving" });
    rerender({ kind: "saved", at: "2026-10-01T12:00:01.000Z" });
    rerender({ kind: "saving" });
    expect(live().textContent).toBe("");
  });

  it("does not announce a draft that opens in a failed state", () => {
    show({ kind: "failed", message: "x" });
    expect(live().textContent).toBe("");
  });

  it("announces entering a failure once, however the failure goes on", () => {
    const { rerender } = show({ kind: "saving" });
    rerender({ kind: "retrying", attempt: 1 });
    expect(live().textContent).toBe("Couldn't save your changes.");

    // Still failing: the same announcement stays, nothing new is spoken.
    rerender({ kind: "retrying", attempt: 2 });
    rerender({ kind: "failed", message: "x" });
    expect(live().textContent).toBe("Couldn't save your changes.");
  });

  it("announces leaving a failure only once the draft is saved again", () => {
    const { rerender } = show({ kind: "saving" });
    rerender({ kind: "failed", message: "x" });
    expect(live().textContent).toBe("Couldn't save your changes.");

    // Trying again is not recovery.
    rerender({ kind: "saving" });
    expect(live().textContent).toBe("Couldn't save your changes.");
    rerender({ kind: "saved", at: "2026-10-01T12:00:00.000Z" });
    expect(live().textContent).toBe("Your changes are saved.");
  });

  it("treats a refused field and an expired session as failures too", () => {
    const { rerender } = show({ kind: "saved", at: null });
    rerender({ kind: "refused", fields: ["start"], message: "x" });
    expect(live().textContent).toBe("Couldn't save your changes.");
    rerender({ kind: "saved", at: null });
    expect(live().textContent).toBe("Your changes are saved.");
    rerender({ kind: "session-expired" });
    expect(live().textContent).toBe("Couldn't save your changes.");
  });

  it("keeps the visible text out of the live region", () => {
    show({ kind: "failed", message: "x" });
    expect(live().textContent).not.toContain("Retry");
    expect(live().closest("[aria-live]")).toBeNull();
  });
});
