import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ModelInput } from "@/lib/repository/types";

import { ModelInputPanel, ModelInputStatus } from "@/components/workspace/model-input-panel";

afterEach(cleanup);

const entry = { id: "mi-inherited-0001", about: { name: "Global 5 min network" } } as ModelInput;
const chosenEntry = { id: "mi-chosen-000002", about: { name: "Regional network" } } as ModelInput;

describe("ModelInputStatus", () => {
  it("says an inherited model input the catalogue holds is found, with a link to it", () => {
    render(
      <ModelInputStatus modelInputId={null} inheritedId="mi-inherited-0001" resolved={entry} />
    );
    expect(screen.getByText("Inherited: Global 5 min network")).toBeTruthy();
    expect(screen.getByText(/found in the catalogue/)).toBeTruthy();
    expect(screen.getByRole("link").getAttribute("href")).toBe("/repository/model-inputs/mi-inherited-0001");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says plainly that an inherited model input the catalogue lacks changes nothing for the run", () => {
    const { container } = render(
      <ModelInputStatus modelInputId={null} inheritedId="mi-inherited-0001" resolved={null} />
    );
    expect(container.textContent).toContain("The catalogue does not list it.");
    expect(container.textContent).toContain("The run fetches it by id, so this changes nothing about the run.");
    expect(container.textContent).not.toContain("found in the catalogue");
  });

  it("does not claim either while still looking", () => {
    const { container } = render(
      <ModelInputStatus modelInputId={null} inheritedId="mi-inherited-0001" resolved={undefined} />
    );
    expect(container.textContent).toContain("Checking the model-inputs catalogue…");
    expect(container.textContent).not.toContain("does not list it");
  });

  it("says which one it is when there is no snapshot to read it from", () => {
    const { container } = render(
      <ModelInputStatus modelInputId={null} inheritedId={null} resolved={null} />
    );
    expect(container.textContent).toContain("the model snapshot could not be loaded");
  });

  it("warns about a chosen model input and reverts it", () => {
    const onRevert = vi.fn();
    const { container } = render(
      <ModelInputStatus
        modelInputId="mi-chosen-000002"
        inheritedId="mi-inherited-0001"
        resolved={chosenEntry}
        onRevert={onRevert}
      />
    );
    expect(screen.getByText("Chosen: Regional network")).toBeTruthy();
    expect(container.textContent).toContain("can't run yet");
    fireEvent.click(screen.getByRole("button", { name: "Revert to inherit" }));
    expect(onRevert).toHaveBeenCalledTimes(1);
  });

  it("names a chosen model input by its id when the catalogue does not hold it, and disables Revert when asked", () => {
    const { container } = render(
      <ModelInputStatus
        modelInputId="mi-chosen-000002"
        inheritedId={null}
        resolved={null}
        onRevert={() => {}}
        disabled
      />
    );
    expect(container.textContent).toContain("Chosen: mi-chosen-00…");
    expect(container.textContent).toContain("The model-inputs catalogue does not hold it.");
    expect((screen.getByRole("button", { name: "Revert to inherit" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("offers no Revert where no handler is given (the review summary)", () => {
    render(
      <ModelInputStatus modelInputId="mi-chosen-000002" inheritedId={null} resolved={chosenEntry} />
    );
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("ModelInputPanel", () => {
  it("shows the status and what the server said about it", () => {
    render(
      <ModelInputPanel
        modelInputId={null}
        inheritedId="mi-inherited-0001"
        resolved={entry}
        error="Model input not found."
      />
    );
    expect(screen.getByRole("heading", { name: "Model input" })).toBeTruthy();
    expect(screen.getByText("Inherited: Global 5 min network")).toBeTruthy();
    expect(screen.getByText("Model input not found.")).toBeTruthy();
  });
});
