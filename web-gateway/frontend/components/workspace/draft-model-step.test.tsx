import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ModelInput } from "@/lib/repository/types";

vi.mock("@/lib/repository/actions", () => ({
  fetchModelInputs: vi.fn(() => new Promise(() => {})),
}));

import { DraftModelStep } from "@/components/workspace/draft-model-step";
import { fakeDataset } from "@/lib/workspace/fixtures";

afterEach(cleanup);

const dataset = fakeDataset({ id: "snap-1" });
const entry = { id: "fake-model-input-id", about: { name: "Global network" } } as ModelInput;

function step(props: Partial<React.ComponentProps<typeof DraftModelStep>> = {}) {
  const onRevertModelInput = vi.fn();
  render(
    <DraftModelStep
      datasetId="snap-1"
      datasetTitle="Stored title"
      ctx={{ dataset, snapshotState: "found" }}
      modelInputId={null}
      resolvedModelInput={entry}
      onRevertModelInput={onRevertModelInput}
      {...props}
    />
  );
  return { onRevertModelInput };
}

describe("DraftModelStep", () => {
  it("has a focusable heading for the wizard to move focus to", () => {
    step();
    const heading = screen.getByRole("heading", { level: 2, name: "Model & input" });
    expect(heading.id).toBe("draft-step-model-heading");
    expect(heading.getAttribute("tabindex")).toBe("-1");
  });

  it("shows the snapshot, the inherited model input and a collapsed catalogue", () => {
    step();
    expect(screen.getByText("Fake Snapshot")).toBeTruthy();
    expect(screen.getByText("Inherited: Global network")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Browse model inputs" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("marks the model input panel for the wizard's focus, and not the catalogue", () => {
    step({ modelInputId: "other-id" });
    const marked = document.querySelector('[data-draft-field="modelInput"]') as HTMLElement;
    expect(marked.contains(screen.getByRole("button", { name: "Revert to inherit" }))).toBe(true);
    expect(marked.contains(screen.getByRole("button", { name: "Browse model inputs" }))).toBe(false);
  });

  it("reverts a chosen model input, and shows the server's refusal", () => {
    const { onRevertModelInput } = step({ modelInputId: "other-id", error: "Not a model input." });
    expect(screen.getByText("Not a model input.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Revert to inherit" }));
    expect(onRevertModelInput).toHaveBeenCalledTimes(1);
  });

  it("still says what it can when the snapshot is gone", () => {
    step({ ctx: { dataset: null, snapshotState: "gone" }, resolvedModelInput: null });
    expect(screen.getByText("Stored title")).toBeTruthy();
    expect(screen.getByText(/no longer in the repository/)).toBeTruthy();
    expect(screen.getByText(/the model snapshot could not be loaded/)).toBeTruthy();
  });
});
