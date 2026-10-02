import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { DraftReviewStep } from "@/components/workspace/draft-review-step";
import { fromJob, type DraftLocal } from "@/lib/workspace/draft-state";
import { fakeDataset, fakeSimulation } from "@/lib/workspace/fixtures";

afterEach(cleanup);

const dataset = fakeDataset({ id: "snap-1" });

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
      serverErrors={{}}
      submitArea={<div data-testid="submit-area">submit here</div>}
      {...handlers}
      {...props}
    />
  );
  return handlers;
}

/** The summary line whose label is `label`. */
const row = (label: string) => screen.getByText(label, { selector: "dt" }).parentElement as HTMLElement;

describe("DraftReviewStep: name and description", () => {
  it("has a focusable heading for the wizard to move focus to", () => {
    review();
    const heading = screen.getByRole("heading", { level: 2, name: "Review & submit" });
    expect(heading.id).toBe("draft-step-review-heading");
    expect(heading.getAttribute("tabindex")).toBe("-1");
  });

  it("shows the name and description, with the placeholder", () => {
    review();
    const name = screen.getByLabelText("Name") as HTMLInputElement;
    const description = screen.getByLabelText("Description") as HTMLTextAreaElement;
    expect(name.value).toBe("My run");
    expect(description.value).toBe("A test");
    expect(name.placeholder).toBe("Untitled (job-1)");
    expect(screen.queryByText(/not a published model snapshot/)).toBeNull();
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

describe("DraftReviewStep: the summary", () => {
  it("is one list: based on, run period, output variables, cores, walltime", () => {
    review();
    expect(screen.getAllByRole("term").map((t) => t.textContent)).toEqual([
      "Based on",
      "Run period",
      "Output variables",
      "Cores",
      "Walltime",
    ]);
    // Nothing is repeated as a card of its own.
    expect(screen.queryByRole("heading", { name: "Model snapshot" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Model input" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Compute" })).toBeNull();
    expect(screen.queryByText("Needs attention")).toBeNull();
  });

  it("links the snapshot to the repository and gives it no Edit", () => {
    review();
    const based = row("Based on");
    expect(within(based).getByText("Fake Snapshot")).toBeTruthy();
    expect(within(based).getByText("wbm 2.0.0 · 2001-01-01 → 2001-12-31 · 0.5 degree")).toBeTruthy();
    expect(within(based).getByRole("link", { name: /View.*in the repository/ }).getAttribute("href")).toBe(
      "/repository/snap-1"
    );
    expect(within(based).queryByRole("button", { name: /Edit/ })).toBeNull();
  });

  it("sends each editable line to its field on the run step", () => {
    const { onEditStep } = review();
    const edits = [
      ["Edit run period", "start"],
      ["Edit output variables", "variables"],
      ["Edit cores", "cores"],
      ["Edit walltime", "walltime"],
    ] as const;
    for (const [name, field] of edits) {
      fireEvent.click(screen.getByRole("button", { name }));
      expect(onEditStep).toHaveBeenLastCalledWith("run", field);
    }
  });

  it("states the run period and the variables as a count with the first few", () => {
    review();
    expect(within(row("Run period")).getByText("2001-03-01 → 2001-06-30")).toBeTruthy();
    expect(within(row("Output variables")).getByText("2 selected")).toBeTruthy();
    expect(within(row("Output variables")).getByText(/discharge, runoff/)).toBeTruthy();
    expect(within(row("Output variables")).queryByRole("button", { name: "show all" })).toBeNull();
    expect(screen.queryByText("Spatial subset")).toBeNull();
    expect(screen.queryByText("Custom parameters")).toBeNull();
  });

  it("shows only the first few of many variables, and all of them on request", () => {
    const names = Array.from({ length: 51 }, (_, i) => `var${i}`);
    review({ local: { ...LOCAL, parameters: { ...LOCAL.parameters, variables: names } } });
    const line = row("Output variables");
    expect(within(line).getByText("51 selected")).toBeTruthy();
    expect(line.textContent).toContain("var0, var1, var2, var3 and 47 more");
    expect(line.textContent).not.toContain("var10");
    fireEvent.click(within(line).getByRole("button", { name: "show all" }));
    expect(line.textContent).toContain("var50");
    expect(within(line).getByRole("button", { name: "show fewer" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("shows a stored spatial subset and custom parameters, and an empty variable list", () => {
    const { onEditStep } = review({
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
    expect(within(row("Spatial subset")).getByText("N5 S-5 E5 W-5")).toBeTruthy();
    expect(within(row("Custom parameters")).getByText("2 custom parameters")).toBeTruthy();
    expect(within(row("Output variables")).getByText("None chosen")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit spatial subset" }));
    expect(onEditStep).toHaveBeenLastCalledWith("run", "spatial");
    fireEvent.click(screen.getByRole("button", { name: "Edit custom parameters" }));
    expect(onEditStep).toHaveBeenLastCalledWith("run", "custom");
  });

  it("shows the compute it will ask for, and where an unset value comes from", () => {
    review();
    expect(within(row("Cores")).getByText("8")).toBeTruthy();
    expect(within(row("Walltime")).getByText("2 h")).toBeTruthy();
    expect(row("Cores").textContent).not.toContain("· recommended");
    expect(row("Walltime").textContent).not.toContain("recommendation");

    cleanup();
    review({ local: { ...LOCAL, slurm: { cores: null, walltime: null } } });
    expect(row("Cores").textContent).toContain("16 · recommended");
    expect(row("Walltime").textContent).toContain("22 min 30 s · model snapshot's recommendation + 50%");
  });

  it("says the low-cores warning once, under Cores, in one line, and only then", () => {
    const BIG = { cores: 64, walltime: "15:00" };
    review({ recommended: BIG, local: { ...LOCAL, slurm: { cores: 1, walltime: null } } });
    const note = within(row("Cores")).getByText("1 core is below the recommended 64: the run may run out of memory.");
    expect(note.className).toContain("text-warning");
    expect(screen.queryByText(/On Anvil's shared partition/)).toBeNull();

    for (const cores of [64, null]) {
      cleanup();
      review({ recommended: BIG, local: { ...LOCAL, slurm: { cores, walltime: null } } });
      expect(screen.queryByText(/below the recommended/)).toBeNull();
    }
    cleanup();
    review({ recommended: null, local: { ...LOCAL, slurm: { cores: 1, walltime: null } } });
    expect(screen.queryByText(/below the recommended/)).toBeNull();
  });

  it("shows an automatic walltime cut to the limit as the limit", () => {
    review({
      local: { ...LOCAL, slurm: { cores: null, walltime: null } },
      recommended: { cores: 16, walltime: "111:30:00" },
    });
    expect(row("Walltime").textContent).toContain("4 d · the limit for one job");
  });

  it("still summarises a draft whose snapshot is gone, with no link to it", () => {
    review({ ctx: { dataset: null, snapshotState: "gone" }, recommended: null });
    expect(within(row("Based on")).getByText("Stored title")).toBeTruthy();
    expect(within(row("Based on")).queryByRole("link")).toBeNull();
    expect(within(row("Cores")).getByText("8")).toBeTruthy();
  });

  it("shows a cleared date as missing", () => {
    review({ local: { ...LOCAL, parameters: { ...LOCAL.parameters, temporal_range_start: "" } } });
    expect(within(row("Run period")).getByText("No start date → 2001-06-30")).toBeTruthy();
  });
});

describe("DraftReviewStep: the rest", () => {
  it("renders the submit area it is given, last", () => {
    review();
    const area = screen.getByTestId("submit-area");
    expect(area.textContent).toBe("submit here");
    expect(area.previousElementSibling?.textContent).toContain("Name and description");
  });

  it("switches its inputs and Edit buttons off while a submit is under way", () => {
    review({ disabled: true });
    const off = (el: Element) => el.matches(":disabled");
    expect(off(screen.getByLabelText("Name"))).toBe(true);
    expect(off(screen.getByLabelText("Description"))).toBe(true);
    expect(off(screen.getByRole("button", { name: "Edit run period" }))).toBe(true);
  });
});
