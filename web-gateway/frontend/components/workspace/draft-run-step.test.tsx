import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { JobParameters } from "@/lib/jobs/types";
import type { Dataset, PostProcessingSettings } from "@/lib/repository/types";

import { DraftRunStep } from "@/components/workspace/draft-run-step";
import type { DraftContext } from "@/lib/workspace/draft-state";
import { fakeDataset, fakeModelParameters } from "@/lib/workspace/fixtures";
import type { ModelParametersState } from "@/lib/workspace/use-model-parameters";

afterEach(cleanup);

/** The block a snapshot's init sets: post-processing on, temporal aggregation, default climatology. */
const SETTINGS: PostProcessingSettings = {
  run: true,
  temporalAggregation: true,
  climatology: true,
  climatologyDefault: true,
  multiYear: null,
  polygonAggregation: false,
  forks: 8,
};

// 2001-01-01 .. 2001-12-31, one file per year, three variables.
const dataset = fakeDataset({
  runStartAlignment: "year",
  climatologyAvailable: true,
  postProcessingSettings: SETTINGS,
  simulation: {
    ...fakeDataset().simulation,
    outputVariables: [
      { name: "discharge", fullName: "Discharge", unit: "m3/s" },
      { name: "runoff", fullName: "Runoff", unit: "mm" },
      { name: "streamAge", fullName: "Stream age", unit: "d" },
    ],
    // 15 min for the run, 45 min for the post-processing a climatology choice adds.
    recommendedCompute: { cores: 16, walltime: "15:00", postProcessingWalltime: "0:45:00" },
  },
});
/** A snapshot with more variables than a flat list holds: runoff, runoff_ps, ... */
function manyVariables() {
  const names = ["runoff", "runoff_ps", "runoff_pu", "discharge", "discharge_ps", "soilMoist", "soilMoist_ps",
    "glMelt", "irrRunoff", "etIrrCrops", "grndWater", "grndWater_pu", "streamAge"];
  return fakeDataset({
    simulation: {
      ...fakeDataset().simulation,
      outputVariables: names.map((name) => ({ name, fullName: name.toUpperCase(), unit: "mm" })) as [
        { name: string; fullName: string; unit: string },
        ...{ name: string; fullName: string; unit: string }[],
      ],
    },
  });
}
const FOUND: DraftContext = { dataset, snapshotState: "found" };
const PARAMETER_TREE: ModelParametersState = { status: "ready", tree: fakeModelParameters() };
const NO_SNAPSHOT: DraftContext = { dataset: null, snapshotState: "unavailable" };

const PARAMETERS: JobParameters = {
  temporal_range_start: "2001-01-01",
  temporal_range_end: "2001-12-31",
  spatial_domain: null,
  variables: ["discharge", "runoff", "streamAge"],
  custom_params: null,
};

function step(props: Partial<React.ComponentProps<typeof DraftRunStep>> = {}) {
  const onParametersChange = vi.fn();
  const onSlurmChange = vi.fn();
  const onNameChange = vi.fn();
  const onDescriptionChange = vi.fn();
  const view = render(
    <DraftRunStep
      datasetId="snap-1"
      datasetTitle="Kept title"
      ctx={FOUND}
      parameters={PARAMETERS}
      slurm={{ cores: null }}
      recommended={dataset.simulation.recommendedCompute}
      modelInputId={null}
      resolvedModelInput={undefined}
      name=""
      description=""
      onNameChange={onNameChange}
      onDescriptionChange={onDescriptionChange}
      serverErrors={{}}
      startRefusal={null}
      onParametersChange={onParametersChange}
      onSlurmChange={onSlurmChange}
      onRevertModelInput={vi.fn()}
      {...props}
    />
  );
  return { onParametersChange, onSlurmChange, onNameChange, onDescriptionChange, ...view };
}

const start = () => screen.getByLabelText("Start") as HTMLInputElement;
const end = () => screen.getByLabelText("End") as HTMLInputElement;
const checkbox = (name: string | RegExp) => screen.getByRole("checkbox", { name }) as HTMLInputElement;
/** Output variables are closed until asked for; the compute fields are always there. */
const openVariables = () => fireEvent.click(screen.getByRole("button", { name: "Choose output variables" }));

/** The output-variable checkboxes: every checkbox but the post-processing one. */
const variableBoxes = () =>
  screen.queryAllByRole("checkbox").filter((c) => c.getAttribute("data-draft-field") !== "postProcessing");

describe("the draft run step: name and description", () => {
  it("starts the card with them, an empty Name that shows an example and no generated name", () => {
    step();
    const sections = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(sections[0]).toBe("Name and description");
    const name = screen.getByLabelText("Name") as HTMLInputElement;
    expect(name.value).toBe("");
    expect(name.placeholder).toMatch(/^e\.g\. /);
    expect(name.placeholder).not.toContain("Untitled");
    expect((screen.getByLabelText(/^Description/) as HTMLTextAreaElement).value).toBe("");
  });

  it("shows what it is given, and reports what is typed, whole", () => {
    const { onNameChange, onDescriptionChange } = step({ name: "My run", description: "A test" });
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("My run");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Renamed" } });
    fireEvent.change(screen.getByLabelText(/^Description/), { target: { value: "New text" } });
    expect(onNameChange).toHaveBeenCalledWith("Renamed");
    expect(onDescriptionChange).toHaveBeenCalledWith("New text");
  });

  it("marks both for the wizard's focus", () => {
    step();
    expect(screen.getByLabelText("Name").getAttribute("data-draft-field")).toBe("name");
    expect(screen.getByLabelText(/^Description/).getAttribute("data-draft-field")).toBe("description");
  });

  it("focuses the Name as the step opens when asked to, and not otherwise", () => {
    const first = step({ autoFocusName: true });
    expect(document.activeElement).toBe(screen.getByLabelText("Name"));
    first.unmount();
    step();
    expect(document.activeElement).not.toBe(screen.getByLabelText("Name"));
  });

  it("shows what the server said about each, and ties it to the field", () => {
    step({ serverErrors: { name: "Name is too long.", description: "Description is too long." } });
    const name = screen.getByLabelText("Name");
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(name.getAttribute("aria-describedby")).toContain(screen.getByText("Name is too long.").id);
    expect(screen.getByLabelText(/^Description/).getAttribute("aria-describedby")).toContain(
      screen.getByText("Description is too long.").id
    );
  });

  it("switches both off while a submit is under way", () => {
    step({ disabled: true });
    expect(screen.getByLabelText("Name").matches(":disabled")).toBe(true);
    expect(screen.getByLabelText(/^Description/).matches(":disabled")).toBe(true);
  });
});

describe("the draft run step: fields the wizard can focus", () => {
  it("marks each control an Edit link can send focus to", () => {
    step({
      parameters: {
        ...PARAMETERS,
        spatial_domain: { north: 5, south: -5, east: 5, west: -5 },
      },
      modelParameters: PARAMETER_TREE,
    });
    openVariables();
    const marked = (field: string) => document.querySelector(`[data-draft-field="${field}"]`) as HTMLElement;
    expect(marked("start")).toBe(start());
    expect(marked("end")).toBe(end());
    expect(marked("cores")).toBe(screen.getByLabelText("Cores"));
    expect(marked("spatial")).toBe(screen.getByRole("button", { name: "Remove" }));
    // Model parameters are closed: the button that opens them is what an Edit link presses.
    expect(document.querySelector('[data-draft-reveals~="custom"]')).toBe(
      screen.getByRole("button", { name: "Edit model parameters" })
    );
    // A short list: focus goes to its first checkbox.
    expect(marked("variables").querySelector("input")).toBe(checkbox("discharge"));
  });

  it("sends focus to the search box of a long list, and to Revert for a model input of its own", () => {
    step({
      modelInputId: "mi-9",
      ctx: { dataset: manyVariables(), snapshotState: "found" },
      parameters: { ...PARAMETERS, variables: [] },
    });
    openVariables();
    const marked = (field: string) => document.querySelector(`[data-draft-field="${field}"]`) as HTMLElement;
    expect(marked("variables")).toBe(screen.getByRole("searchbox", { name: "Search output variables" }));
    expect(marked("modelInput")).toBe(screen.getByRole("button", { name: "Revert" }));
  });
});

describe("the draft run step: the quiet path", () => {
  const marked = (field: string) => document.querySelector(`[data-draft-field="${field}"]`);

  it("shows the run period and the compute fields, and only a line and a button for the variables", () => {
    step();
    expect(start()).toBeTruthy();
    expect(end()).toBeTruthy();
    expect(variableBoxes()).toHaveLength(0);
    expect(screen.getByLabelText("Cores")).toBeTruthy();
    // The walltime is not the user's: no field for it.
    expect(screen.queryByLabelText(/Walltime/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Choose output variables" }).textContent).toBe("Choose…");
    expect(screen.queryByRole("button", { name: /compute/i })).toBeNull();
  });

  it("is a white card for each of the five parts, with no tinted band", () => {
    const { container } = step();
    const sections = Array.from(container.querySelectorAll("section"));
    expect(sections).toHaveLength(5);
    for (const section of sections) expect(section.className).toContain("rounded-card");
    expect(container.innerHTML).not.toContain("bg-muted/40");
  });

  it("draws the period over the snapshot's coverage, for the eye only", () => {
    step();
    const bar = screen.getByTestId("run-period-bar");
    expect(bar.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByTestId("run-period-fill")).toBeTruthy();
  });

  it("draws the variables as a bar of segments for the eye only, and says how many are selected", () => {
    const { container } = step();
    const bar = screen.getByTestId("variables-bar");
    expect(bar.getAttribute("aria-hidden")).toBe("true");
    expect(bar.children.length).toBeGreaterThan(0);
    expect(container.querySelector('[data-testid="variables-bar"] > div')?.className).toContain("bg-data-1/20");
    expect(screen.getByText("All 3 variables").parentElement?.textContent).toContain("All 3 variables selected");
  });

  it("fills a segment of the bar as far as its variables are chosen", () => {
    step({ parameters: { ...PARAMETERS, variables: [] } });
    const fills = screen.getByTestId("variables-bar").querySelectorAll(":scope > div > div");
    expect(fills.length).toBeGreaterThan(0);
    for (const fill of fills) {
      expect((fill as HTMLElement).style.width).toBe("0%");
    }
  });

  it("says in one line what the variables are", () => {
    const { unmount } = step();
    expect(screen.getByText("All 3 variables")).toBeTruthy();
    unmount();
    step({ parameters: { ...PARAMETERS, variables: ["runoff", "streamAge"] } });
    expect(screen.getByText("2 of 3 variables")).toBeTruthy();
    expect(screen.getByText(/runoff, streamAge/)).toBeTruthy();
  });

  it("names the first few variables when not all are chosen, and counts the rest", () => {
    const names = manyVariables().simulation.outputVariables.map((v) => v.name);
    step({
      ctx: { dataset: manyVariables(), snapshotState: "found" },
      parameters: { ...PARAMETERS, variables: names.slice(0, 5) },
    });
    expect(screen.getByText("5 of 13 variables")).toBeTruthy();
    expect(screen.getByText(/runoff, runoff_ps, runoff_pu and 2 more/)).toBeTruthy();
  });

  it("says All N and nothing more for a long list that is all chosen", () => {
    const names = manyVariables().simulation.outputVariables.map((v) => v.name);
    step({ ctx: { dataset: manyVariables(), snapshotState: "found" }, parameters: { ...PARAMETERS, variables: names } });
    expect(screen.getByText("All 13 variables")).toBeTruthy();
    expect(screen.queryByText(/runoff, runoff_ps/)).toBeNull();
  });

  it("opens the variables with Choose… and closes them with Done, keeping the summary", () => {
    step();
    const toggle = screen.getByRole("button", { name: "Choose output variables" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(variableBoxes()).toHaveLength(3);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.textContent).toBe("Done");
    expect(document.getElementById(toggle.getAttribute("aria-controls")!)).toBeTruthy();
    expect(screen.getByText("All 3 variables")).toBeTruthy();
    fireEvent.click(toggle);
    expect(variableBoxes()).toHaveLength(0);
  });

  it("shows the draft's own cores in the field, and the recommendation as its placeholder", () => {
    const { unmount } = step();
    expect((screen.getByLabelText("Cores") as HTMLInputElement).value).toBe("");
    expect(screen.getByLabelText("Cores").getAttribute("placeholder")).toBe("16");
    unmount();
    step({ slurm: { cores: 8 } });
    expect((screen.getByLabelText("Cores") as HTMLInputElement).value).toBe("8");
  });

  it("keeps a variables problem in view with the list closed", () => {
    const { unmount } = step({ parameters: { ...PARAMETERS, variables: [] } });
    expect(screen.getByText("None selected")).toBeTruthy();
    expect(screen.getByText(/Choose at least one output variable/)).toBeTruthy();
    expect(variableBoxes()).toHaveLength(0);
    unmount();
    step({ serverErrors: { variables: "Unknown variable." } });
    expect(screen.getByText("Unknown variable.")).toBeTruthy();
    expect(variableBoxes()).toHaveLength(0);
  });

  it("keeps the list open, with no way to close it, while a variable is not in the snapshot", () => {
    step({ parameters: { ...PARAMETERS, variables: ["discharge", "legacyVar"] } });
    expect(variableBoxes()).toHaveLength(4);
    expect(screen.queryByRole("button", { name: /output variables/ })).toBeNull();
  });

  it("keeps the compute fields open, with their message, for a value that is refused", () => {
    step({ slurm: { cores: 0 } });
    expect(screen.getByText("Use a whole number from 1 to 128.")).toBeTruthy();
    expect(screen.getByLabelText("Cores").getAttribute("aria-invalid")).toBe("true");
    expect(screen.queryByRole("button", { name: /compute/ })).toBeNull();
  });

  it("marks the variables button so that an Edit link can open it, and has the compute fields in place", () => {
    step();
    expect(screen.getByRole("button", { name: "Choose output variables" }).getAttribute("data-draft-reveals")).toBe("variables");
    expect(marked("variables")).toBeNull();
    expect(marked("cores")).toBe(screen.getByLabelText("Cores"));
  });
});

describe("the draft run step: dates", () => {
  it("has a focusable heading for the wizard to move focus to", () => {
    step();
    const heading = screen.getByRole("heading", { level: 2, name: "Run settings" });
    expect(heading.id).toBe("draft-step-run-heading");
    expect(heading.getAttribute("tabindex")).toBe("-1");
  });

  it("bounds the dates by the snapshot's coverage and states the rule", () => {
    step();
    expect(start().min).toBe("2001-01-01");
    expect(start().max).toBe("2001-12-31");
    expect(end().min).toBe("2001-01-01");
    // The limits are said once, in one line under the two dates.
    expect(screen.getByText("Start on January 1 · Coverage 2001-01-01 → 2001-12-31")).toBeTruthy();
    expect(screen.queryByText(/one file per year/)).toBeNull();
    expect(start().getAttribute("aria-invalid")).toBeNull();
    expect(start().getAttribute("aria-describedby")).toBe(end().getAttribute("aria-describedby"));
  });

  it("passes an edited date on, and nothing else of the parameters", () => {
    const { onParametersChange } = step();
    fireEvent.change(end(), { target: { value: "2001-06-30" } });
    expect(onParametersChange).toHaveBeenCalledWith({ ...PARAMETERS, temporal_range_end: "2001-06-30" });
  });

  it("flags a start the rule forbids and offers the fix", () => {
    const { onParametersChange } = step({
      parameters: { ...PARAMETERS, temporal_range_start: "2001-03-15" },
    });
    expect(start().getAttribute("aria-invalid")).toBe("true");
    const error = document.getElementById(start().getAttribute("aria-describedby")!.split(" ")[1]);
    expect(error?.textContent).toContain("Start on January 1.");
    fireEvent.click(screen.getByRole("button", { name: "Use 2001-01-01" }));
    expect(onParametersChange).toHaveBeenCalledWith({
      ...PARAMETERS,
      temporal_range_start: "2001-01-01",
      temporal_range_end: "2001-12-31",
    });
  });

  it("shows the server's refusal of a start once, with the fix as a button", () => {
    // No snapshot to check against: only the server could refuse it.
    const message = "This model's runs start on January 1. Start on 2001-01-01 instead.";
    step({
      ctx: NO_SNAPSHOT,
      parameters: { ...PARAMETERS, temporal_range_start: "2001-03-15" },
      startRefusal: { message, suggestion: "2001-01-01" },
      serverErrors: { start: message },
    });
    expect(start().getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("This model's runs start on January 1.")).toBeTruthy();
    expect(screen.queryAllByText(/Start on 2001-01-01 instead/)).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Use 2001-01-01" })).toBeTruthy();
  });

  it("keeps a refusal's text whole when it does not end with the suggestion", () => {
    step({
      ctx: NO_SNAPSHOT,
      startRefusal: { message: "Not a valid start.", suggestion: null },
    });
    expect(screen.getByText("Not a valid start.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Use / })).toBeNull();
  });

  it("offers no fix when no allowed start is inside the coverage", () => {
    const narrow = fakeDataset({
      runStartAlignment: "year",
      simulation: {
        ...dataset.simulation,
        temporalCoverage: { start: "2001-03-01", end: "2001-12-31" },
      },
    });
    step({
      ctx: { dataset: narrow, snapshotState: "found" },
      parameters: { ...PARAMETERS, temporal_range_start: "2001-05-01" },
    });
    expect(start().getAttribute("aria-invalid")).toBe("true");
    expect(screen.queryByRole("button", { name: /^Use / })).toBeNull();
  });

  it("says it could not check a model whose rule is unknown, and flags nothing", () => {
    step({
      ctx: { dataset: fakeDataset({ runStartAlignment: null }), snapshotState: "found" },
      parameters: { ...PARAMETERS, temporal_range_start: "2001-03-01" },
    });
    expect(screen.getByText(/Couldn.t read the model.s date rules just now/)).toBeTruthy();
    expect(start().getAttribute("aria-invalid")).toBeNull();
  });

  it("says nothing about a model with no rule", () => {
    step({
      ctx: { dataset: fakeDataset({ runStartAlignment: "none" }), snapshotState: "found" },
      parameters: { ...PARAMETERS, temporal_range_start: "2001-03-01" },
    });
    expect(screen.queryByText(/Couldn.t read the model/)).toBeNull();
    expect(screen.queryByText(/Start on/)).toBeNull();
    expect(start().getAttribute("aria-invalid")).toBeNull();
  });

  it("flags an end the snapshot's multi-year aggregation cannot run with, on the End field", () => {
    // 2000-01-01 .. 2001-12-31, aggregating from 2001: the simulation that failed on Anvil.
    const aggregated = fakeDataset({
      runStartAlignment: "year",
      aggregationStartYear: 2001,
      simulation: {
        ...dataset.simulation,
        temporalCoverage: { start: "2000-01-01", end: "2001-12-31" },
      },
    });
    step({
      ctx: { dataset: aggregated, snapshotState: "found" },
      parameters: { ...PARAMETERS, temporal_range_start: "2000-01-01", temporal_range_end: "2000-12-31" },
    });
    expect(end().getAttribute("aria-invalid")).toBe("true");
    // Red under the field, short; the line under the dates says the limit once.
    const message = document.getElementById(end().getAttribute("aria-describedby")!.split(" ")[1])?.textContent;
    expect(message).toBe("End on 2001-12-31.");
    expect(screen.getByText("Start on January 1 · End on 2001-12-31 · Coverage 2000-01-01 → 2001-12-31")).toBeTruthy();
    expect(screen.queryByText(/allowed:/)).toBeNull();
    expect(start().getAttribute("aria-invalid")).toBeNull();
  });

  it("flags a start after the aggregation's year on the Start field, and clears for valid dates", () => {
    const aggregated = fakeDataset({
      runStartAlignment: "year",
      aggregationStartYear: 2001,
      simulation: {
        ...dataset.simulation,
        temporalCoverage: { start: "2000-01-01", end: "2003-12-31" },
      },
    });
    const ctx: DraftContext = { dataset: aggregated, snapshotState: "found" };
    const { unmount } = step({
      ctx,
      parameters: { ...PARAMETERS, temporal_range_start: "2002-01-01", temporal_range_end: "2003-12-31" },
    });
    expect(start().getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Start no later than 2001-12-31.")).toBeTruthy();
    unmount();
    step({
      ctx,
      parameters: { ...PARAMETERS, temporal_range_start: "2001-01-01", temporal_range_end: "2003-12-31" },
    });
    expect(start().getAttribute("aria-invalid")).toBeNull();
    expect(end().getAttribute("aria-invalid")).toBeNull();
  });

  it("says a date that does not exist and an end before the start", () => {
    step({ parameters: { ...PARAMETERS, temporal_range_start: "", temporal_range_end: "2000-01-01" } });
    expect(screen.getByText("Choose a start date that exists.")).toBeTruthy();
    expect(start().getAttribute("aria-invalid")).toBe("true");
    const { unmount } = step({ parameters: { ...PARAMETERS, temporal_range_end: "2000-12-31" } });
    expect(screen.getByText("The end date is before the start date.")).toBeTruthy();
    unmount();
  });

  it("shows what the server said about a date it refused for another reason", () => {
    step({ serverErrors: { start: "Start is not a date.", end: "End is too late." } });
    expect(screen.getByText("Start is not a date.")).toBeTruthy();
    expect(screen.getByText("End is too late.")).toBeTruthy();
    expect(end().getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(end().getAttribute("aria-describedby")!.split(" ")[1])?.textContent).toBe(
      "End is too late."
    );
  });
});

describe("the draft run step: without a snapshot", () => {
  it("sets no min or max, says why, and lists only the stored variables", () => {
    step({
      ctx: NO_SNAPSHOT,
      recommended: null,
      parameters: { ...PARAMETERS, variables: ["discharge"] },
    });
    expect(start().min).toBe("");
    expect(start().max).toBe("");
    expect(end().max).toBe("");
    expect(screen.getByText(/isn't available, so the dates aren't checked/)).toBeTruthy();
    // Nothing to compare with, so no "All" and no "of": the stored variables, as they are.
    expect(screen.getByText("1 variable")).toBeTruthy();
    expect(screen.getByText(/own list isn't\s+available/)).toBeTruthy();
    openVariables();
    expect(variableBoxes().map((c) => (c as HTMLInputElement).checked)).toEqual([true]);
    expect(screen.getByRole("checkbox", { name: "discharge" })).toBeTruthy();
    expect(screen.queryByText("not in this snapshot")).toBeNull();
    // The compute fields have no recommendation to show.
    expect(screen.getByLabelText("Cores").getAttribute("placeholder")).toBe("Recommended");
  });
});

describe("the draft run step: output variables", () => {
  it("lists the snapshot's variables and keeps the stored order when one is ticked", () => {
    const { onParametersChange } = step({ parameters: { ...PARAMETERS, variables: ["runoff", "streamAge"] } });
    openVariables();
    expect(screen.getByText("2 of 3 variables")).toBeTruthy();
    expect(checkbox("discharge").checked).toBe(false);
    fireEvent.click(checkbox("discharge"));
    // Stored in the snapshot's own order, not in the order they were ticked.
    expect(onParametersChange).toHaveBeenCalledWith({
      ...PARAMETERS,
      variables: ["discharge", "runoff", "streamAge"],
    });
  });

  it("unticks a variable", () => {
    const { onParametersChange } = step();
    openVariables();
    fireEvent.click(checkbox("runoff"));
    expect(onParametersChange).toHaveBeenCalledWith({ ...PARAMETERS, variables: ["discharge", "streamAge"] });
  });

  it("keeps a stored variable the snapshot does not list, marks it, and lets it go", () => {
    const { onParametersChange } = step({
      parameters: { ...PARAMETERS, variables: ["discharge", "legacyVar"] },
    });
    expect(screen.getByText("2 of 4 variables")).toBeTruthy();
    // The mark is part of the checkbox's name, so a screen reader hears it too.
    expect(checkbox("legacyVar not in this snapshot").checked).toBe(true);
    expect(screen.getByText("not in this snapshot")).toBeTruthy();

    fireEvent.click(checkbox(/^legacyVar/));
    expect(onParametersChange).toHaveBeenCalledWith({ ...PARAMETERS, variables: ["discharge"] });
  });

  it("keeps an unknown variable last when another is ticked", () => {
    const { onParametersChange } = step({
      parameters: { ...PARAMETERS, variables: ["legacyVar", "runoff"] },
    });
    fireEvent.click(checkbox("discharge"));
    expect(onParametersChange).toHaveBeenCalledWith({
      ...PARAMETERS,
      variables: ["discharge", "runoff", "legacyVar"],
    });
  });

  it("warns when none is chosen", () => {
    step({ parameters: { ...PARAMETERS, variables: [] } });
    expect(screen.getByText(/Choose at least one output variable/)).toBeTruthy();
  });

  it("titles each variable with its full name and unit", () => {
    step();
    openVariables();
    expect(screen.getByText("discharge").getAttribute("title")).toBe("Discharge (m3/s)");
  });

  it("shows what the server said about the variables", () => {
    step({ serverErrors: { variables: "Unknown variable." } });
    expect(screen.getByText("Unknown variable.")).toBeTruthy();
  });
});

describe("the draft run step: what a submit refuses", () => {
  const subset = { north: 5, south: -5, east: 5, west: -5 };

  it("shows nothing about a spatial subset a draft does not have", () => {
    step();
    expect(screen.queryByText(/spatial subset/i)).toBeNull();
    expect(screen.queryByRole("checkbox", { name: /spatial/i })).toBeNull();
    expect(screen.queryByText(/Not available yet/)).toBeNull();
    expect(screen.queryByText(/\.init/)).toBeNull();
    expect(screen.queryByText(/Settings that can't run yet/)).toBeNull();
  });

  it("removes a stored spatial subset", () => {
    const { onParametersChange } = step({ parameters: { ...PARAMETERS, spatial_domain: subset } });
    expect(screen.getByText(/remove it to submit/)).toBeTruthy();
    expect(screen.getByText("N5 S-5 E5 W-5")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onParametersChange).toHaveBeenCalledWith({ ...PARAMETERS, spatial_domain: null });
  });

  it("lists no custom parameters here: they are the Model parameters section's now", () => {
    step({ parameters: { ...PARAMETERS, custom_params: { alpha: "1" } } });
    expect(screen.queryByText(/can't run yet/)).toBeNull();
    expect(screen.queryByText("alpha = 1")).toBeNull();
  });

  it("keeps the spatial subset in its own block, without a custom parameters line", () => {
    step({
      parameters: { ...PARAMETERS, spatial_domain: subset, custom_params: { "wbmParam.alpha": "7" } },
      modelParameters: PARAMETER_TREE,
    });
    expect(screen.getByText(/Settings that can't run yet/)).toBeTruthy();
    expect(screen.queryByText(/custom parameters/i)).toBeNull();
  });
});

describe("the draft run step: model parameters", () => {
  const sectionHeading = () => screen.queryByRole("heading", { level: 3, name: "Model parameters" });

  it("has a Model parameters section, closed, after post-processing and before compute", () => {
    step({ modelParameters: PARAMETER_TREE });
    const titles = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(titles.indexOf("Model parameters")).toBe(titles.indexOf("Post-processing") + 1);
    expect(titles.indexOf("Compute")).toBe(titles.indexOf("Model parameters") + 1);
    expect(screen.getByText("WBM 22.1.1 · No parameters changed")).toBeTruthy();
    expect(screen.queryByLabelText("Soil moisture drying coefficient")).toBeNull();
  });

  it("draws nothing for them when no tree was given", () => {
    step();
    expect(sectionHeading()).toBeNull();
  });

  it("shows how many parameters the draft changes", () => {
    step({
      modelParameters: PARAMETER_TREE,
      parameters: { ...PARAMETERS, custom_params: { "wbmParam.alpha": "7", Glaciers: "" } },
    });
    expect(screen.getByText("WBM 22.1.1 · 2 parameters changed")).toBeTruthy();
  });

  it("writes a changed value into custom_params with the rest of the parameters, and a reset takes it out", () => {
    const first = step({ modelParameters: PARAMETER_TREE });
    fireEvent.click(screen.getByRole("button", { name: "Edit model parameters" }));
    fireEvent.click(screen.getByRole("button", { name: /^WBM parameters/ }));
    fireEvent.change(screen.getByLabelText("Soil moisture drying coefficient"), { target: { value: "7" } });
    expect(first.onParametersChange).toHaveBeenCalledWith({ ...PARAMETERS, custom_params: { "wbmParam.alpha": "7" } });
    first.unmount();

    const second = step({
      modelParameters: PARAMETER_TREE,
      parameters: { ...PARAMETERS, custom_params: { "wbmParam.alpha": "7" } },
    });
    fireEvent.click(screen.getByRole("button", { name: "Edit model parameters" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset Soil moisture drying coefficient" }));
    expect(second.onParametersChange).toHaveBeenCalledWith({ ...PARAMETERS, custom_params: null });
  });

  it("switches a module off with an empty value", () => {
    const { onParametersChange } = step({ modelParameters: PARAMETER_TREE });
    fireEvent.click(screen.getByRole("button", { name: "Edit model parameters" }));
    fireEvent.click(screen.getByRole("button", { name: /^WBM parameters/ }));
    fireEvent.click(screen.getByRole("button", { name: "Switch off Runoff from Glaciated Areas" }));
    expect(onParametersChange).toHaveBeenCalledWith({ ...PARAMETERS, custom_params: { Glaciers: "" } });
  });

  it("shows the backend's messages at the fields, and the message for the whole set", () => {
    step({
      modelParameters: PARAMETER_TREE,
      parameters: { ...PARAMETERS, custom_params: { "wbmParam.alpha": "abc" } },
      customErrors: { "wbmParam.alpha": "Enter a number." },
      serverErrors: { custom: "Some model parameters are not valid." },
    });
    expect(screen.getByText("Some model parameters are not valid.")).toBeTruthy();
    expect(screen.getByLabelText("Soil moisture drying coefficient").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Enter a number.")).toBeTruthy();
  });

  it("is still a section, and says so, when the tree could not be read; the rest of the step works", () => {
    const retry = vi.fn();
    const { onNameChange } = step({
      modelParameters: { status: "unavailable" },
      onRetryModelParameters: retry,
    });
    expect(screen.getByText("Not available for this snapshot")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Still works" } });
    expect(onNameChange).toHaveBeenCalledWith("Still works");
  });

  it("switches its controls off while a submit is under way", () => {
    step({
      disabled: true,
      modelParameters: PARAMETER_TREE,
      parameters: { ...PARAMETERS, custom_params: { "wbmParam.alpha": "7" } },
    });
    expect(screen.getByRole("button", { name: "Edit model parameters" }).matches(":disabled")).toBe(true);
  });
});

describe("the draft run step: compute", () => {
  it("says what is recommended under each field", () => {
    step();
    expect(screen.getByText("Recommended 16").id).toBe(
      screen.getByLabelText("Cores").getAttribute("aria-describedby")!.split(" ").find((i) => i.endsWith("-cores-hint"))
    );
    // Only cores are recommended here: the time is the review step's estimate.
    expect(screen.getAllByText(/^Recommended /)).toHaveLength(1);
  });

  it("says nothing is recommended when the snapshot gave nothing to recommend", () => {
    step({ recommended: null });
    expect(screen.queryByText(/^Recommended \d/)).toBeNull();
  });

  it("passes cores on", () => {
    const { onSlurmChange } = step({ slurm: { cores: null } });
    fireEvent.change(screen.getByLabelText("Cores"), { target: { value: "4" } });
    expect(onSlurmChange).toHaveBeenCalledWith({ cores: 4 });
    expect(screen.getByLabelText("Cores").getAttribute("placeholder")).toBe("16");
  });

  it("shows what the server said about cores", () => {
    step({ serverErrors: { cores: "Too many cores." } });
    // A refused value keeps the field open, the message under it.
    expect(screen.getByText("Too many cores.").previousElementSibling).toBe(screen.getByLabelText("Cores"));
  });
});

describe("the draft run step: a reference simulation that does not fit in one job", () => {
  it("says nothing about the time or about jobs, however long the reference simulation took", () => {
    step({ recommended: { cores: 16, walltime: "111:30:00" } });
    expect(screen.queryByText(/\d+ jobs/)).toBeNull();
    expect(screen.queryByText(/limit for one job|reference simulation took/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Why?" })).toBeNull();
    expect(screen.queryByLabelText(/Walltime/i)).toBeNull();
  });
});

describe("the draft run step: cores below the recommended count", () => {
  const BIG = { cores: 64, walltime: "15:00" };
  const warning = () => screen.queryByText(/1 core is below the recommended 64/);

  it("warns next to the Cores field, with the numbers, and does not make it an error", () => {
    step({ recommended: BIG, slurm: { cores: 1 } });
    // In view with the fields closed.
    const note = warning()!;
    expect(note.textContent).toContain("1 core is below the recommended 64: the simulation may run out of memory.");
    // The arithmetic is behind "Why?".
    expect(screen.queryByText(/enough memory for its run/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Why?" }));
    expect(screen.getByText(/On Anvil's shared partition memory comes with cores/).textContent).toBe(
      "This model snapshot recommends 64 cores, enough memory for its simulation. " +
        "On Anvil's shared partition memory comes with cores, about 1.9 GB each, " +
        "so 64 cores gives about 121.3 GB and 1 core only about 1.9 GB: " +
        "the simulation may be stopped for running out of memory."
    );
    const cores = screen.getByLabelText("Cores");
    expect(cores.getAttribute("aria-describedby")).toContain(note.closest("div")!.id);
    expect(cores.getAttribute("aria-invalid")).not.toBe("true");
  });

  it("appears and goes as the value is typed", () => {
    const { onSlurmChange, rerender } = step({ recommended: BIG });
    expect(warning()).toBeNull();
    fireEvent.change(screen.getByLabelText("Cores"), { target: { value: "1" } });
    expect(onSlurmChange).toHaveBeenLastCalledWith({ cores: 1 });

    const props = (cores: number | null) => (
      <DraftRunStep
        datasetId="snap-1"
        datasetTitle="Kept title"
        ctx={FOUND}
        parameters={PARAMETERS}
        slurm={{ cores }}
        recommended={BIG}
        modelInputId={null}
        resolvedModelInput={undefined}
        name=""
        description=""
        onNameChange={vi.fn()}
        onDescriptionChange={vi.fn()}
        serverErrors={{}}
        startRefusal={null}
        onParametersChange={vi.fn()}
        onSlurmChange={vi.fn()}
        onRevertModelInput={vi.fn()}
      />
    );
    rerender(props(1));
    expect(warning()).toBeTruthy();
    rerender(props(64));
    expect(warning()).toBeNull();
    rerender(props(null));
    expect(warning()).toBeNull();
  });

  it("says nothing without a recommendation", () => {
    step({ recommended: null, slurm: { cores: 1 } });
    expect(screen.queryByText(/snapshot recommends/)).toBeNull();
  });
});

describe("the draft run step: disabled", () => {
  it("switches every control off while a submit is under way", () => {
    step({
      disabled: true,
      parameters: { ...PARAMETERS, spatial_domain: { north: 1, south: 0, east: 1, west: 0 }, custom_params: { a: "b" } },
    });
    const off = (el: Element) => el.matches(":disabled");
    expect(off(start())).toBe(true);
    expect(off(end())).toBe(true);
    expect(off(screen.getByRole("button", { name: "Choose output variables" }))).toBe(true);
    expect(off(screen.getByLabelText("Cores"))).toBe(true);
    for (const remove of screen.getAllByRole("button", { name: "Remove" })) expect(off(remove)).toBe(true);
  });
});

describe("the draft run step: a long list of output variables", () => {
  const all = () => manyVariables().simulation.outputVariables.map((v) => v.name);
  const long = (variables = all()) => ({
    ctx: { dataset: manyVariables(), snapshotState: "found" } as DraftContext,
    parameters: { ...PARAMETERS, variables },
  });

  it("has a search box, Select all and Clear, and the summary says how much is selected", () => {
    step(long());
    openVariables();
    expect(screen.getByRole("searchbox", { name: "Search output variables" })).toBeTruthy();
    expect(screen.getByText("All 13 variables")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Select all" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear" })).toBeTruthy();
  });

  it("has none of them for a short list, which is just the checkboxes", () => {
    step();
    openVariables();
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.queryByText("Other variables")).toBeNull();
    expect(variableBoxes()).toHaveLength(3);
  });

  it("groups the names that share a base, and the rest follow as other variables", () => {
    step(long());
    openVariables();
    const group = (name: RegExp) => screen.getByRole("checkbox", { name });
    expect(group(/^runoff: all 3 variables/)).toBeTruthy();
    expect(group(/^discharge: all 2 variables/)).toBeTruthy();
    expect(group(/^soilMoist: all 2 variables/)).toBeTruthy();
    expect(group(/^grndWater: all 2 variables/)).toBeTruthy();
    expect(screen.getByText("Other variables")).toBeTruthy();
  });

  it("ticks and unticks a whole group, in the snapshot's order", () => {
    const { onParametersChange } = step(long(["discharge"]));
    openVariables();
    fireEvent.click(screen.getByRole("checkbox", { name: /^runoff: all 3 variables/ }));
    expect(onParametersChange).toHaveBeenLastCalledWith({
      ...PARAMETERS,
      variables: ["runoff", "runoff_ps", "runoff_pu", "discharge"],
    });
  });

  it("clears everything, and selects everything", () => {
    const { onParametersChange } = step(long(["discharge"]));
    openVariables();
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(onParametersChange).toHaveBeenLastCalledWith({ ...PARAMETERS, variables: all() });
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onParametersChange).toHaveBeenLastCalledWith({ ...PARAMETERS, variables: [] });
  });

  it("filters by name or title, and then Select and Clear act on the matches only", () => {
    const { onParametersChange } = step(long(["streamAge"]));
    openVariables();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search output variables" }), {
      target: { value: "soil" },
    });
    expect(screen.queryByRole("checkbox", { name: "runoff" })).toBeNull();
    expect(screen.getByRole("checkbox", { name: "soilMoist_ps" })).toBeTruthy();
    // The count is of the draft, not of the matches.
    expect(screen.getByText("1 of 13 variables")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Select shown" }));
    expect(onParametersChange).toHaveBeenLastCalledWith({
      ...PARAMETERS,
      variables: ["soilMoist", "soilMoist_ps", "streamAge"],
    });
  });

  it("says when nothing matches", () => {
    step(long());
    openVariables();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search output variables" }), {
      target: { value: "zzz" },
    });
    expect(screen.getByText(/No variable matches/)).toBeTruthy();
  });
});

describe("the draft run step: what the draft is based on", () => {
  it("is one small card: map, the snapshot's title, one line of facts with the model input, and a link", () => {
    step({ resolvedModelInput: { about: { name: "WBM Inputs [CONUS]" } } as never });
    // The title is the headline, whole in the page, cut to two lines by CSS, and on hover.
    const name = screen.getByText("Fake Snapshot");
    expect(name.getAttribute("title")).toBe("Fake Snapshot");
    expect(name.className).toContain("line-clamp-2");
    expect(screen.getByRole("img", { name: /^Coverage: north 10°/ })).toBeTruthy();
    expect(
      screen.getByText((_, el) => el?.tagName === "P" && /^WBM 23\.9\.0 · 2001 · 0\.5° · Model input:/.test(el.textContent ?? ""))
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "WBM Inputs [CONUS]" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /View in repository/ }).getAttribute("href")).toBe("/repository/snap-1");
  });

  it("says a snapshot that left the repository is gone, and keeps its title", () => {
    step({ ctx: { dataset: null, snapshotState: "gone" } });
    expect(screen.getByText("Kept title")).toBeTruthy();
    expect(screen.getByText(/no longer in the repository/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: /View in repository/ })).toBeNull();
  });

  it("says it could not load a snapshot it could not fetch, and links to it", () => {
    step({ ctx: NO_SNAPSHOT });
    expect(screen.getByText(/couldn't load this model snapshot/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /View in repository/ })).toBeTruthy();
  });

  it("offers to revert a model input of the draft's own, and says what the server said about it", () => {
    const onRevertModelInput = vi.fn();
    step({
      modelInputId: "mi-9",
      onRevertModelInput,
      serverErrors: { modelInput: "No such model input." },
    });
    expect(screen.getByText(/uses a different model input/)).toBeTruthy();
    expect(screen.getByText("No such model input.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Revert" }));
    expect(onRevertModelInput).toHaveBeenCalled();
  });

  it("has no revert when the draft inherits the snapshot's model input", () => {
    step();
    expect(screen.queryByRole("button", { name: "Revert" })).toBeNull();
  });
});

describe("the draft run step: the Post-processing choice", () => {
  const CHECKBOX = "Run post-processing after the simulation";
  const box = () => screen.getByRole("checkbox", { name: CHECKBOX }) as HTMLInputElement;
  const climatologyDataset = fakeDataset({
    ...dataset,
    postProcessing: "climatology",
  });

  it("is a switch to look at and a checkbox to everything else: one input with its own label, and a track hidden from assistive technology", () => {
    step();
    const input = box();
    expect(input.type).toBe("checkbox");
    expect(screen.getByLabelText(CHECKBOX)).toBe(input);
    expect(input.nextElementSibling?.getAttribute("aria-hidden")).toBe("true");
  });

  it("is one checkbox, unchecked when the snapshot's own is standard and the draft has none", () => {
    step({ ctx: { dataset: fakeDataset({ ...dataset, postProcessing: "standard" }), snapshotState: "found" } });
    expect(screen.getAllByRole("checkbox", { name: CHECKBOX })).toHaveLength(1);
    expect(screen.queryByRole("radio")).toBeNull();
    expect(box().checked).toBe(false);
  });

  it("is checked for the snapshot's climatology, and unchecked when the init could not be read", () => {
    const { unmount } = step({ ctx: { dataset: climatologyDataset, snapshotState: "found" } });
    expect(box().checked).toBe(true);
    unmount();
    const unread = step({ ctx: { dataset: fakeDataset({ ...dataset, postProcessing: null, postProcessingSettings: null }), snapshotState: "found" } });
    expect(box().checked).toBe(false);
    expect(box().disabled).toBe(false);
    expect(screen.getByText("What it writes depends on the snapshot's init, which could not be read just now.")).toBeTruthy();
    unread.unmount();
    step({ ctx: NO_SNAPSHOT });
    expect(box().checked).toBe(false);
  });

  it("shows the draft's own choice over the snapshot's", () => {
    step({
      ctx: { dataset: climatologyDataset, snapshotState: "found" },
      parameters: { ...PARAMETERS, post_processing: "standard" },
    });
    expect(box().checked).toBe(false);
    cleanup();
    step({ parameters: { ...PARAMETERS, post_processing: "climatology" } });
    expect(box().checked).toBe(true);
  });

  it("reports the toggled value whole, even the snapshot's own, and changes nothing else", () => {
    const first = step();
    fireEvent.click(box());
    expect(first.onParametersChange).toHaveBeenLastCalledWith({ ...PARAMETERS, post_processing: "climatology" });
    first.unmount();
    // On a climatology snapshot, unchecking stores standard.
    const second = step({ ctx: { dataset: climatologyDataset, snapshotState: "found" } });
    fireEvent.click(box());
    expect(second.onParametersChange).toHaveBeenLastCalledWith({ ...PARAMETERS, post_processing: "standard" });
  });

  it("says what post-processing writes: the file count (variables chosen x 3) and the measurement", () => {
    const { unmount } = step();
    expect(
      screen.getByText("Writes daily, monthly and yearly climatologies of each output variable (9 files).")
    ).toBeTruthy();
    expect(
      screen.getByText(/Measured on this snapshot's reference period at 16 cores: about 45 min on top of the run time/)
    ).toBeTruthy();
    expect(screen.queryByText(/CONUS/)).toBeNull();
    unmount();
    step({ parameters: { ...PARAMETERS, variables: ["runoff"] } });
    expect(screen.getByText(/\(3 files\)/)).toBeTruthy();
  });

  it("leaves the count out when no variable is chosen", () => {
    step({ parameters: { ...PARAMETERS, variables: [] } });
    expect(screen.getByText("Writes daily, monthly and yearly climatologies of each output variable.")).toBeTruthy();
  });

  it.each([
    [
      "multi-year climatologies",
      { multiYear: { start: 2001, step: 2 } },
      "Writes daily, monthly and yearly climatologies of each output variable (9 files) and yearly climatologies over 2-year periods from 2001.",
    ],
    [
      "polygon aggregates",
      { polygonAggregation: true },
      "Writes daily, monthly and yearly climatologies of each output variable (9 files) and aggregates over polygons.",
    ],
    [
      "all three",
      { multiYear: { start: 1990, step: 5 }, polygonAggregation: true },
      "Writes daily, monthly and yearly climatologies of each output variable (9 files), yearly climatologies over 5-year periods from 1990 and aggregates over polygons.",
    ],
    [
      "polygons only (climatology off)",
      { climatology: false, polygonAggregation: true },
      "Writes aggregates over polygons.",
    ],
    [
      "polygons only (temporal aggregation off)",
      { temporalAggregation: false, polygonAggregation: true },
      "Writes aggregates over polygons.",
    ],
    [
      "no multi-year without climatology",
      { climatology: false, multiYear: { start: 2001, step: 2 } },
      "This snapshot's init sets nothing for post-processing to write, so running it produces nothing.",
    ],
    [
      "nothing",
      { climatology: false },
      "This snapshot's init sets nothing for post-processing to write, so running it produces nothing.",
    ],
  ] as [string, Partial<PostProcessingSettings>, string][])("describes %s from the snapshot's init", (_label, changes, line) => {
    step({
      ctx: { dataset: fakeDataset({ ...dataset, postProcessingSettings: { ...SETTINGS, ...changes } }), snapshotState: "found" },
    });
    expect(screen.getByText(line)).toBeTruthy();
  });

  describe("the read-only list of what the init sets", () => {
    const dlElement = () => {
      const dl = screen.getByText("Set in this snapshot's init").parentElement!.querySelector("dl");
      if (!dl) throw new Error("no list");
      return dl;
    };
    const list = () => within(dlElement());
    /** The dt/dd pairs as [label + key, value + note] texts, in order. */
    const rows = () => {
      return Array.from(dlElement().querySelectorAll("dt")).map((dt) => [
        dt.textContent,
        dt.nextElementSibling?.textContent,
      ]);
    };
    const withSettings = (changes: Partial<PostProcessingSettings>, extra: Partial<Dataset> = {}) =>
      step({
        ctx: {
          dataset: fakeDataset({ ...dataset, ...extra, postProcessingSettings: { ...SETTINGS, ...changes } }),
          snapshotState: "found",
        },
      });

    it("lists each setting with its init key, in order, for a plain init", () => {
      withSettings({});
      expect(rows()).toEqual([
        ["Run after the simulationRun", "On"],
        ["Temporal aggregationTemporal_Aggregation", "On"],
        ["ClimatologyClimatology", "On (default)"],
        ["Multi-year climatologyTA_multi_year_start, TA_multi_year_timestep", "Not set"],
        ["Polygon aggregationPolygon_Aggregation", "Not set"],
        ["ForksForks", "8A run that post-processes uses the simulation's cores instead."],
      ]);
    });

    it("shows v1_Global_tracking.init: run off, temporal aggregation on, nothing else set", () => {
      withSettings({ run: false });
      const [run, temporal, climatology, multiYear, polygon] = rows();
      expect(run[1]).toBe("Off");
      expect(temporal[1]).toBe("On");
      expect(climatology[1]).toBe("On (default)");
      expect(multiYear[1]).toBe("Not set");
      expect(polygon[1]).toBe("Not set");
    });

    it("shows init_files_wbm_test.init: the multi-year pair and 4 forks, no default marker when Climatology is stated", () => {
      withSettings({ multiYear: { start: 2001, step: 2 }, forks: 4, climatologyDefault: false });
      const r = rows();
      expect(r[2][1]).toBe("On");
      expect(r[3][1]).toBe("Every 2 years from 2001");
      expect(r[5][1]).toMatch(/^4/);
      expect(screen.queryByText(/No effect/)).toBeNull();
    });

    it("says one year, and a missing Forks falls back to WBM's default", () => {
      withSettings({ multiYear: { start: 1990, step: 1 }, forks: null });
      expect(list().getByText("Every 1 year from 1990")).toBeTruthy();
      expect(list().getByText("Not set (WBM's default is 8)")).toBeTruthy();
    });

    it("says a set polygon aggregation is Set", () => {
      withSettings({ polygonAggregation: true });
      expect(list().getByText("Set")).toBeTruthy();
    });

    it("marks climatology and multi-year as without effect when temporal aggregation is off", () => {
      withSettings({ temporalAggregation: false, multiYear: { start: 2001, step: 2 } });
      const r = rows();
      expect(r[1][1]).toBe("Off");
      expect(r[2][1]).toBe("On (default)No effect: temporal aggregation is off.");
      expect(r[3][1]).toBe("Every 2 years from 2001No effect: temporal aggregation is off.");
    });

    it("marks multi-year as without effect when climatology is off, and says nothing about the off climatology itself", () => {
      withSettings({ climatology: false, climatologyDefault: false, multiYear: { start: 2001, step: 2 } });
      const r = rows();
      expect(r[2][1]).toBe("Off");
      expect(r[3][1]).toBe("Every 2 years from 2001No effect: climatology is off.");
    });

    it("does not note an unset multi-year pair", () => {
      withSettings({ temporalAggregation: false });
      expect(rows()[3][1]).toBe("Not set");
    });

    it("is shown while the checkbox is disabled", () => {
      withSettings({}, { climatologyAvailable: false });
      expect(box().disabled).toBe(true);
      expect(rows()).toHaveLength(6);
    });

    it("puts each value in a pill, green for what the init switches on", () => {
      withSettings({ run: false });
      const pills = (text: string) => list().getAllByText(text);
      expect(pills("Off")[0].className).toContain("bg-muted");
      expect(pills("On")[0].className).toContain("bg-success/10");
      expect(pills("On (default)")[0].className).toContain("bg-success/10");
      expect(pills("Not set")[0].className).toContain("bg-muted");
    });

    it("has nothing to edit", () => {
      withSettings({});
      expect(dlElement().querySelectorAll("input, select, textarea, button")).toHaveLength(0);
      expect(dlElement().getAttribute("aria-labelledby")).toBe(screen.getByText("Set in this snapshot's init").id);
    });

    it("is absent when the init has no block, or could not be read", () => {
      const none = step({
        ctx: { dataset: fakeDataset({ ...dataset, postProcessing: "none", postProcessingSettings: null }), snapshotState: "found" },
      });
      expect(screen.queryByText("Set in this snapshot's init")).toBeNull();
      none.unmount();
      step({
        ctx: { dataset: fakeDataset({ ...dataset, postProcessing: null, postProcessingSettings: null }), snapshotState: "found" },
      });
      expect(screen.queryByText("Set in this snapshot's init")).toBeNull();
    });
  });

  it("is disabled, with one line, for a snapshot whose init has no post-processing settings", () => {
    step({
      ctx: {
        dataset: fakeDataset({ ...dataset, postProcessing: "none", postProcessingSettings: null }),
        snapshotState: "found",
      },
    });
    expect(box().disabled).toBe(true);
    expect(box().checked).toBe(false);
    expect(screen.getByText("This snapshot's init has no post-processing settings.")).toBeTruthy();
    expect(screen.queryByText(/^Writes /)).toBeNull();
  });

  it.each([
    ["false", false],
    ["absent", undefined],
  ])("disables the checkbox, still saying what it would write, while climatologyAvailable is %s", (_label, available) => {
    step({ ctx: { dataset: fakeDataset({ ...dataset, climatologyAvailable: available }), snapshotState: "found" } });
    expect(box().disabled).toBe(true);
    expect(box().checked).toBe(false);
    // The pill beside the label says it, and the line says why.
    const pill = screen.getByText("Not available yet");
    expect(pill.closest("label")).toBeNull();
    expect(box().getAttribute("aria-describedby")).toContain(pill.id);
    const why = screen.getByText(
      "WBM's post-processing time grows with a snapshot's size and period, and the gateway does not plan for it yet."
    );
    expect(screen.getByText(/^Writes /)).toBeTruthy();
    expect(screen.queryByText(/Measured on this snapshot/)).toBeNull();
    expect(box().getAttribute("aria-describedby")).toContain(why.parentElement!.id);
  });

  it("lets a stored climatology be unchecked while it is off", () => {
    const view = step({
      ctx: { dataset: fakeDataset({ ...dataset, climatologyAvailable: false }), snapshotState: "found" },
      parameters: { ...PARAMETERS, post_processing: "climatology" },
    });
    expect(box().disabled).toBe(false);
    fireEvent.click(box());
    expect(view.onParametersChange).toHaveBeenLastCalledWith({ ...PARAMETERS, post_processing: "standard" });
  });

  it("shows a stored climatology checked while it is off, with the server's refusal on the field", () => {
    step({
      ctx: { dataset: fakeDataset({ ...dataset, climatologyAvailable: false }), snapshotState: "found" },
      parameters: { ...PARAMETERS, post_processing: "climatology" },
      serverErrors: { postProcessing: "Climatology is not available yet." },
    });
    expect(box().checked).toBe(true);
    const error = screen.getByText("Climatology is not available yet.");
    expect(box().getAttribute("aria-describedby")).toContain(error.id);
  });

  it("shows what the server said about it, tied to the checkbox", () => {
    step({ serverErrors: { postProcessing: "Not for this snapshot." } });
    expect(box().getAttribute("aria-describedby")).toContain(screen.getByText("Not for this snapshot.").id);
  });

  it("is marked for the wizard's focus, and switched off while a submit is under way", () => {
    const { unmount } = step();
    expect(box().getAttribute("data-draft-field")).toBe("postProcessing");
    unmount();
    step({ disabled: true });
    expect(box().matches(":disabled")).toBe(true);
  });
});
