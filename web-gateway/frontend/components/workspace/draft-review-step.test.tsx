import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ModelInput } from "@/lib/repository/types";

import { DraftReviewStep } from "@/components/workspace/draft-review-step";
import { fromJob, type DraftLocal, type SubmitProblem } from "@/lib/workspace/draft-state";
import { fakeDataset, fakeSimulation } from "@/lib/workspace/fixtures";

afterEach(cleanup);

const dataset = fakeDataset({ id: "snap-1" });
const catalogueEntry = { id: "fake-model-input-id", about: { name: "Global network" } } as ModelInput;

const LOCAL: DraftLocal = fromJob(
  fakeSimulation("DRAFT", {
    about: { name: "My run", description: "A test" },
    parameters: {
      temporal_range_start: "2001-03-01",
      temporal_range_end: "2001-06-30",
      spatial_domain: null,
      variables: ["discharge", "runoff"],
      custom_params: null,
    },
    slurm_config: { cores: 8, walltime: "02:00:00" },
  })
);

function review(props: Partial<React.ComponentProps<typeof DraftReviewStep>> = {}) {
  const handlers = {
    onNameChange: vi.fn(),
    onDescriptionChange: vi.fn(),
    onEditStep: vi.fn(),
  };
  render(
    <DraftReviewStep
      datasetId="snap-1"
      datasetTitle="Stored title"
      fallbackName="Untitled (job-1)"
      ctx={{ dataset, snapshotState: "found" }}
      local={LOCAL}
      recommended={dataset.simulation.recommendedCompute}
      modelInput={catalogueEntry}
      problems={[]}
      serverErrors={{}}
      submitCard={<div data-testid="submit-card">submit here</div>}
      {...handlers}
      {...props}
    />
  );
  return handlers;
}

/** The card whose title is `title`. */
const card = (title: string) => screen.getByRole("heading", { name: title }).closest('[data-slot="card"]') as HTMLElement;

describe("DraftReviewStep: name and description", () => {
  it("has a focusable heading for the wizard to move focus to", () => {
    review();
    const heading = screen.getByRole("heading", { level: 2, name: "Review & submit" });
    expect(heading.id).toBe("draft-step-review-heading");
    expect(heading.getAttribute("tabindex")).toBe("-1");
  });

  it("shows the name and description, with the placeholder and the hint", () => {
    review();
    const name = screen.getByLabelText("Name") as HTMLInputElement;
    const description = screen.getByLabelText("Description") as HTMLTextAreaElement;
    expect(name.value).toBe("My run");
    expect(description.value).toBe("A test");
    expect(name.placeholder).toBe("Untitled (job-1)");
    const hint = screen.getByText(/describe this simulation, not a published model snapshot/);
    expect(name.getAttribute("aria-describedby")).toContain(hint.id);
    expect(description.getAttribute("aria-describedby")).toContain(hint.id);
  });

  it("has what the draft is called with no name as the Name placeholder", () => {
    review({ fallbackName: "my-slug", local: { ...LOCAL, name: "" } });
    const name = screen.getByLabelText("Name") as HTMLInputElement;
    expect(name.value).toBe("");
    expect(name.placeholder).toBe("my-slug");
  });

  it("marks the two inputs for the wizard's focus", () => {
    review();
    expect(screen.getByLabelText("Name").getAttribute("data-draft-field")).toBe("name");
    expect(screen.getByLabelText("Description").getAttribute("data-draft-field")).toBe("description");
  });

  it("reports what is typed, whole", () => {
    const { onNameChange, onDescriptionChange } = review();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Renamed" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "New text" } });
    expect(onNameChange).toHaveBeenCalledWith("Renamed");
    expect(onDescriptionChange).toHaveBeenCalledWith("New text");
  });

  it("shows what the server said about each, and ties it to the field", () => {
    review({ serverErrors: { name: "Name is too long.", description: "Description is too long." } });
    const name = screen.getByLabelText("Name");
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(name.getAttribute("aria-describedby")).toContain(screen.getByText("Name is too long.").id);
    expect(screen.getByLabelText("Description").getAttribute("aria-describedby")).toContain(
      screen.getByText("Description is too long.").id
    );
  });
});

describe("DraftReviewStep: the summaries", () => {
  it("links the snapshot to the repository and gives it no Edit", () => {
    review();
    const snapshot = card("Model snapshot");
    expect(within(snapshot).getByText("Fake Snapshot")).toBeTruthy();
    expect(within(snapshot).getByRole("link", { name: /View in the repository/ }).getAttribute("href")).toBe(
      "/repository/snap-1"
    );
    expect(within(snapshot).queryByRole("button", { name: /Edit/ })).toBeNull();
  });

  it("sends each of the other summaries to the step that edits it", () => {
    const { onEditStep } = review();
    fireEvent.click(within(card("Model input")).getByRole("button", { name: "Edit model input" }));
    expect(onEditStep).toHaveBeenLastCalledWith("model", undefined);
    fireEvent.click(within(card("Run settings")).getByRole("button", { name: "Edit run settings" }));
    expect(onEditStep).toHaveBeenLastCalledWith("run", undefined);
    fireEvent.click(within(card("Compute")).getByRole("button", { name: "Edit compute" }));
    expect(onEditStep).toHaveBeenLastCalledWith("run", undefined);
  });

  it("summarises the run settings", () => {
    review();
    const run = card("Run settings");
    expect(within(run).getByText("2001-03-01 → 2001-06-30")).toBeTruthy();
    expect(within(run).getByText("Output variables (2)")).toBeTruthy();
    expect(within(run).getByText("discharge")).toBeTruthy();
    expect(within(run).getByText("runoff")).toBeTruthy();
    expect(within(run).queryByText("Spatial subset")).toBeNull();
    expect(within(run).queryByText("Custom parameters")).toBeNull();
  });

  it("shows a stored spatial subset and custom parameters, and an empty variable list", () => {
    review({
      local: {
        ...LOCAL,
        parameters: {
          ...LOCAL.parameters,
          variables: [],
          spatial_domain: { north: 5, south: -5, east: 5, west: -5 },
          custom_params: { a: "1", b: "2" },
        },
      },
    });
    const run = card("Run settings");
    expect(within(run).getByText("N5 S-5 E5 W-5")).toBeTruthy();
    expect(within(run).getByText("2 custom parameters")).toBeTruthy();
    expect(within(run).getByText("None chosen")).toBeTruthy();
  });

  it("shows the compute it will ask for, and where an unset value comes from", () => {
    review();
    const compute = card("Compute");
    expect(within(compute).getByText("8")).toBeTruthy();
    expect(within(compute).getByText("2 h")).toBeTruthy();
    expect(within(compute).queryByText(/recommendation/)).toBeNull();

    cleanup();
    review({ local: { ...LOCAL, slurm: { cores: null, walltime: null } } });
    const unset = card("Compute");
    expect(within(unset).getByText("16")).toBeTruthy();
    expect(within(unset).getByText("22 min 30 s")).toBeTruthy();
    expect(within(unset).getByText("model snapshot's recommendation")).toBeTruthy();
    expect(within(unset).getByText("model snapshot's recommendation + 50%")).toBeTruthy();
  });

  it("shows an automatic walltime cut to the limit as the limit", () => {
    review({
      local: { ...LOCAL, slurm: { cores: null, walltime: null } },
      recommended: { cores: 16, walltime: "111:30:00" },
    });
    const compute = card("Compute");
    expect(within(compute).getByText("4 d")).toBeTruthy();
    expect(within(compute).getByText("the limit for one job")).toBeTruthy();
    expect(within(compute).queryByText("model snapshot's recommendation + 50%")).toBeNull();
  });

  it("says what the model input is, from the catalogue lookup the wizard shares", () => {
    review();
    expect(within(card("Model input")).getByText("Inherited: Global network")).toBeTruthy();
    cleanup();
    review({ local: { ...LOCAL, modelInputId: "other" }, modelInput: null });
    expect(within(card("Model input")).getByText(/Chosen:/)).toBeTruthy();
    // No Revert here: that is step 2's.
    expect(within(card("Model input")).queryByRole("button", { name: "Revert to inherit" })).toBeNull();
  });

  it("still summarises a draft whose snapshot is gone", () => {
    review({ ctx: { dataset: null, snapshotState: "gone" }, recommended: null, modelInput: null });
    expect(within(card("Model snapshot")).getByText("Stored title")).toBeTruthy();
    expect(within(card("Compute")).getAllByText("8")).toHaveLength(1);
  });

  it("shows a cleared date as missing", () => {
    review({ local: { ...LOCAL, parameters: { ...LOCAL.parameters, temporal_range_start: "" } } });
    expect(within(card("Run settings")).getByText("No start date → 2001-06-30")).toBeTruthy();
  });
});

describe("DraftReviewStep: needs attention", () => {
  const problems: SubmitProblem[] = [
    { step: "review", message: "You are not permitted to run simulations yet." },
    { field: "start", step: "run", message: "Choose a start date that exists." },
    { field: "modelInput", step: "model", message: "A different model input can't run yet." },
  ];

  it("is absent when nothing is in the way", () => {
    review();
    expect(screen.queryByRole("heading", { name: "Needs attention" })).toBeNull();
  });

  it("lists each problem and links the ones about a field to its step, with the field", () => {
    const { onEditStep } = review({ problems });
    const list = screen.getByRole("heading", { name: "Needs attention" }).closest("section") as HTMLElement;
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(3);

    // A problem of the whole draft has nothing to edit.
    expect(items[0].textContent).toContain("You are not permitted to run simulations yet.");
    expect(within(items[0]).queryByRole("button")).toBeNull();

    expect(items[1].textContent).toContain("Start date: Choose a start date that exists.");
    fireEvent.click(within(items[1]).getByRole("button", { name: "Edit start date" }));
    expect(onEditStep).toHaveBeenLastCalledWith("run", "start");

    fireEvent.click(within(items[2]).getByRole("button", { name: "Edit model input" }));
    expect(onEditStep).toHaveBeenLastCalledWith("model", "modelInput");
  });
});

describe("DraftReviewStep: the rest", () => {
  it("renders the submit card it is given", () => {
    review();
    expect(screen.getByTestId("submit-card").textContent).toBe("submit here");
  });

  it("switches its inputs and Edit buttons off while a submit is under way", () => {
    review({ disabled: true, problems: [{ field: "start", step: "run", message: "x" }] });
    const off = (el: Element) => el.matches(":disabled");
    expect(off(screen.getByLabelText("Name"))).toBe(true);
    expect(off(screen.getByLabelText("Description"))).toBe(true);
    expect(off(screen.getByRole("button", { name: "Edit run settings" }))).toBe(true);
    expect(off(screen.getByRole("button", { name: "Edit start date" }))).toBe(true);
  });
});
