import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { JobParameters } from "@/lib/jobs/types";

import { DraftRunStep } from "@/components/workspace/draft-run-step";
import type { DraftContext } from "@/lib/workspace/draft-state";
import { fakeDataset } from "@/lib/workspace/fixtures";

afterEach(cleanup);

// 2001-01-01 .. 2001-12-31, one file per year, three variables.
const dataset = fakeDataset({
  runStartAlignment: "year",
  simulation: {
    ...fakeDataset().simulation,
    outputVariables: [
      { name: "discharge", fullName: "Discharge", unit: "m3/s" },
      { name: "runoff", fullName: "Runoff", unit: "mm" },
      { name: "streamAge", fullName: "Stream age", unit: "d" },
    ],
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
      slurm={{ cores: null, walltime: null }}
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
/** Output variables and Compute are closed until asked for. */
const openVariables = () => fireEvent.click(screen.getByRole("button", { name: "Choose output variables" }));
const openCompute = () => fireEvent.click(screen.getByRole("button", { name: "Change compute" }));

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
        custom_params: { a: "1" },
      },
    });
    openVariables();
    openCompute();
    const marked = (field: string) => document.querySelector(`[data-draft-field="${field}"]`) as HTMLElement;
    expect(marked("start")).toBe(start());
    expect(marked("end")).toBe(end());
    expect(marked("cores")).toBe(screen.getByLabelText("Cores"));
    expect(marked("walltime")).toBe(screen.getByLabelText(/^Walltime/));
    const removes = screen.getAllByRole("button", { name: "Remove" });
    expect(marked("spatial")).toBe(removes[0]);
    expect(marked("custom")).toBe(removes[1]);
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

  it("shows the run period, and only a line and a button for the variables and the compute", () => {
    step();
    expect(start()).toBeTruthy();
    expect(end()).toBeTruthy();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryByLabelText("Cores")).toBeNull();
    expect(screen.queryByLabelText(/^Walltime/)).toBeNull();
    expect(screen.getByRole("button", { name: "Choose output variables" }).textContent).toBe("Choose…");
    expect(screen.getByRole("button", { name: "Change compute" }).textContent).toBe("Change");
  });

  it("is one card of five parts, with no tinted band", () => {
    const { container } = step();
    const panel = container.querySelector(".divide-y") as HTMLElement;
    expect(panel.querySelectorAll(":scope > section")).toHaveLength(5);
    expect(panel.className).toContain("rounded-xl");
    expect(container.innerHTML).not.toContain("bg-muted/40");
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
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.textContent).toBe("Done");
    expect(document.getElementById(toggle.getAttribute("aria-controls")!)).toBeTruthy();
    expect(screen.getByText("All 3 variables")).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("says what the compute is in one line: the recommendation, or the draft's own values", () => {
    const { unmount } = step();
    expect(screen.getByText("Recommended: 16 cores · 22 min 30 s")).toBeTruthy();
    unmount();
    step({ slurm: { cores: 8, walltime: "12:00:00" } });
    expect(screen.getByText("Custom: 8 cores · 12 h")).toBeTruthy();
    // Still reachable.
    openCompute();
    expect((screen.getByLabelText("Cores") as HTMLInputElement).value).toBe("8");
  });

  it("keeps a variables problem in view with the list closed", () => {
    const { unmount } = step({ parameters: { ...PARAMETERS, variables: [] } });
    expect(screen.getByText("None selected")).toBeTruthy();
    expect(screen.getByText(/Choose at least one output variable/)).toBeTruthy();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    unmount();
    step({ serverErrors: { variables: "Unknown variable." } });
    expect(screen.getByText("Unknown variable.")).toBeTruthy();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("keeps the list open, with no way to close it, while a variable is not in the snapshot", () => {
    step({ parameters: { ...PARAMETERS, variables: ["discharge", "legacyVar"] } });
    expect(screen.getAllByRole("checkbox")).toHaveLength(4);
    expect(screen.queryByRole("button", { name: /output variables/ })).toBeNull();
  });

  it("keeps the compute fields open, with their message, for a value that is refused", () => {
    step({ slurm: { cores: 0, walltime: null } });
    expect(screen.getByText("Use a whole number from 1 to 128.")).toBeTruthy();
    expect(screen.getByLabelText("Cores").getAttribute("aria-invalid")).toBe("true");
    expect(screen.queryByRole("button", { name: /compute/ })).toBeNull();
  });

  it("marks the two buttons so that an Edit link can open them", () => {
    step();
    expect(screen.getByRole("button", { name: "Choose output variables" }).getAttribute("data-draft-reveals")).toBe("variables");
    expect(screen.getByRole("button", { name: "Change compute" }).getAttribute("data-draft-reveals")).toBe("cores walltime");
    expect(marked("variables")).toBeNull();
    expect(marked("cores")).toBeNull();
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
    expect(screen.getByText(/Start date not checked here/)).toBeTruthy();
    expect(start().getAttribute("aria-invalid")).toBeNull();
  });

  it("says nothing about a model with no rule", () => {
    step({
      ctx: { dataset: fakeDataset({ runStartAlignment: "none" }), snapshotState: "found" },
      parameters: { ...PARAMETERS, temporal_range_start: "2001-03-01" },
    });
    expect(screen.queryByText(/not checked here/)).toBeNull();
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
    expect(screen.getByText("Recommended: set by the model snapshot")).toBeTruthy();
    openVariables();
    expect(screen.getAllByRole("checkbox").map((c) => (c as HTMLInputElement).checked)).toEqual([true]);
    expect(screen.getByRole("checkbox", { name: "discharge" })).toBeTruthy();
    expect(screen.queryByText("not in this snapshot")).toBeNull();
    // The compute fields have no recommendation to show.
    openCompute();
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

  it("shows nothing about a spatial subset, or a custom parameter, a draft does not have", () => {
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

  it("lists stored custom parameters and removes them", () => {
    const { onParametersChange } = step({
      parameters: { ...PARAMETERS, custom_params: { alpha: "1", beta: "two" } },
    });
    expect(screen.getByText(/This draft has custom parameters/)).toBeTruthy();
    expect(screen.getByText("alpha = 1")).toBeTruthy();
    expect(screen.getByText("beta = two")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onParametersChange).toHaveBeenCalledWith({ ...PARAMETERS, custom_params: null });
  });

  it("says nothing about custom parameters when there are none", () => {
    step({ parameters: { ...PARAMETERS, custom_params: {} } });
    expect(screen.queryByText(/custom parameters/)).toBeNull();
  });
});

describe("the draft run step: compute", () => {
  it("passes cores and walltime on", () => {
    const { onSlurmChange } = step({ slurm: { cores: null, walltime: "02:00:00" } });
    openCompute();
    fireEvent.change(screen.getByLabelText("Cores"), { target: { value: "4" } });
    expect(onSlurmChange).toHaveBeenCalledWith({ cores: 4, walltime: "02:00:00" });
    expect(screen.getByLabelText("Cores").getAttribute("placeholder")).toBe("16");
  });

  it("shows what the server said about cores and walltime", () => {
    step({ serverErrors: { cores: "Too many cores.", walltime: "Too long." } });
    // Refused values keep the fields open, the message under its own field.
    expect(screen.getByText("Too many cores.").previousElementSibling).toBe(screen.getByLabelText("Cores"));
    expect(screen.getByText("Too long.").previousElementSibling).toBe(screen.getByLabelText(/^Walltime/));
  });
});

describe("the draft run step: a walltime the snapshot's reference simulation does not fit in", () => {
  const long = { cores: 16, walltime: "111:30:00" };

  it("explains it next to the Walltime field, and shows the automatic one as the limit", () => {
    step({ recommended: long });
    // Visible with the fields closed.
    const notice = screen.getByText(/reference simulation took about 111 h 30 min, more than the 96 h/);
    expect(screen.getByText("Recommended: 16 cores · 4 d (limit for one job)")).toBeTruthy();
    openCompute();
    expect(notice.textContent).toMatch(/Shorten the run period or set a walltime\./);
    // One line, with the long reason behind a button.
    expect(screen.queryByText(/the simulation may be stopped when time runs out/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Why?" }));
    expect(screen.getByText(/the simulation may be stopped when time runs out/)).toBeTruthy();
    const walltime = screen.getByLabelText(/^Walltime/);
    expect(walltime.getAttribute("aria-describedby")).toContain(notice.closest("div")!.id);
    expect(walltime.getAttribute("placeholder")).toBe("96:00:00");
    expect(screen.getByText("Empty = recommended: 16 cores, 4 d (the limit for one job).")).toBeTruthy();
  });

  it("is gone once the draft sets a walltime of its own", () => {
    step({ recommended: long, slurm: { cores: null, walltime: "96:00:00" } });
    expect(screen.queryByText(/more than the 96 h/)).toBeNull();
    expect(screen.getByText("Custom: 16 cores (recommended) · 4 d")).toBeTruthy();
  });

  it("says nothing for a recommendation that fits", () => {
    step();
    expect(screen.queryByText(/reference simulation took/)).toBeNull();
    openCompute();
    expect(screen.getByLabelText(/^Walltime/).getAttribute("placeholder")).toBe("00:22:30");
    expect(screen.getByText("Empty = recommended: 16 cores, 22 min 30 s.")).toBeTruthy();
  });

  it("only hints, without an error, at a walltime shorter than the reference simulation", () => {
    step({ recommended: { cores: 16, walltime: "4:30:00" }, slurm: { cores: null, walltime: "02:00:00" } });
    expect(screen.getByText(/reference simulation took about 4 h 30 min/)).toBeTruthy();
    openCompute();
    expect(screen.getByLabelText(/^Walltime/).getAttribute("aria-invalid")).not.toBe("true");
  });
});

describe("the draft run step: cores below the recommended count", () => {
  const BIG = { cores: 64, walltime: "15:00" };
  const warning = () => screen.queryByText(/1 core is below the recommended 64/);

  it("warns next to the Cores field, with the numbers, and does not make it an error", () => {
    step({ recommended: BIG, slurm: { cores: 1, walltime: null } });
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
    openCompute();
    const cores = screen.getByLabelText("Cores");
    expect(cores.getAttribute("aria-describedby")).toContain(note.closest("div")!.id);
    expect(cores.getAttribute("aria-invalid")).not.toBe("true");
  });

  it("appears and goes as the value is typed", () => {
    const { onSlurmChange, rerender } = step({ recommended: BIG });
    expect(warning()).toBeNull();
    openCompute();
    fireEvent.change(screen.getByLabelText("Cores"), { target: { value: "1" } });
    expect(onSlurmChange).toHaveBeenLastCalledWith({ cores: 1, walltime: null });

    const props = (cores: number | null) => (
      <DraftRunStep
        datasetId="snap-1"
        datasetTitle="Kept title"
        ctx={FOUND}
        parameters={PARAMETERS}
        slurm={{ cores, walltime: null }}
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
    step({ recommended: null, slurm: { cores: 1, walltime: null } });
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
    expect(off(screen.getByRole("button", { name: "Change compute" }))).toBe(true);
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
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
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

describe("the draft run step: the Output choice", () => {
  const radio = (name: string | RegExp) => screen.getByRole("radio", { name }) as HTMLInputElement;
  const STANDARD = /Daily, monthly and yearly/;
  const CLIMATOLOGY = /Also climatology/;
  const climatologyDataset = fakeDataset({
    ...dataset,
    postProcessing: "climatology",
  });

  it("is two radios in a group named Output, the snapshot's own choice ticked when the draft has none", () => {
    step({ ctx: { dataset: fakeDataset({ ...dataset, postProcessing: "standard" }), snapshotState: "found" } });
    expect(screen.getByRole("radiogroup", { name: "Output" })).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(radio(STANDARD).checked).toBe(true);
    expect(radio(CLIMATOLOGY).checked).toBe(false);
    expect(screen.getByText(/as the published simulation/)).toBeTruthy();
  });

  it("defaults to the snapshot's climatology, and to standard when the init could not be read", () => {
    const { unmount } = step({ ctx: { dataset: climatologyDataset, snapshotState: "found" } });
    expect(radio(CLIMATOLOGY).checked).toBe(true);
    unmount();
    const unread = step({ ctx: { dataset: fakeDataset({ ...dataset, postProcessing: null }), snapshotState: "found" } });
    expect(radio(STANDARD).checked).toBe(true);
    expect(radio(STANDARD).disabled).toBe(false);
    expect(radio(CLIMATOLOGY).disabled).toBe(false);
    unread.unmount();
    step({ ctx: NO_SNAPSHOT });
    expect(radio(STANDARD).checked).toBe(true);
  });

  it("shows the draft's own choice over the snapshot's", () => {
    step({
      ctx: { dataset: climatologyDataset, snapshotState: "found" },
      parameters: { ...PARAMETERS, post_processing: "standard" },
    });
    expect(radio(STANDARD).checked).toBe(true);
    expect(radio(CLIMATOLOGY).checked).toBe(false);
  });

  it("reports the picked value whole, even the snapshot's own, and changes nothing else", () => {
    const first = step();
    fireEvent.click(radio(CLIMATOLOGY));
    expect(first.onParametersChange).toHaveBeenLastCalledWith({ ...PARAMETERS, post_processing: "climatology" });
    first.unmount();
    // On a climatology snapshot, standard is the one that is not ticked.
    const second = step({ ctx: { dataset: climatologyDataset, snapshotState: "found" } });
    fireEvent.click(radio(STANDARD));
    expect(second.onParametersChange).toHaveBeenLastCalledWith({ ...PARAMETERS, post_processing: "standard" });
  });

  it("notes, under Also climatology, the file count (variables chosen x 3) and the measurement", () => {
    const { unmount } = step();
    expect(screen.getByText(/9 files for this snapshot/)).toBeTruthy();
    expect(screen.getByText(/about a fifth more run time, and 2\.2 GB of climatology on 1\.5 GB of output/)).toBeTruthy();
    unmount();
    step({ parameters: { ...PARAMETERS, variables: ["runoff"] } });
    expect(screen.getByText(/3 files for this snapshot/)).toBeTruthy();
  });

  it("leaves the count out when no variable is chosen", () => {
    step({ parameters: { ...PARAMETERS, variables: [] } });
    expect(screen.queryByText(/files for this snapshot/)).toBeNull();
  });

  it("is disabled, with one line, for a snapshot whose init has no post-processing settings", () => {
    step({ ctx: { dataset: fakeDataset({ ...dataset, postProcessing: "none" }), snapshotState: "found" } });
    expect(radio(STANDARD).disabled).toBe(true);
    expect(radio(CLIMATOLOGY).disabled).toBe(true);
    expect(screen.getByText("This snapshot's init has no post-processing settings.")).toBeTruthy();
    expect(screen.queryByText(/files for this snapshot/)).toBeNull();
  });

  it("shows what the server said about it, tied to the group", () => {
    step({ serverErrors: { postProcessing: "Not for this snapshot." } });
    const group = screen.getByRole("radiogroup", { name: "Output" });
    expect(group.getAttribute("aria-describedby")).toContain(screen.getByText("Not for this snapshot.").id);
  });

  it("is marked for the wizard's focus, and switched off while a submit is under way", () => {
    const { unmount } = step();
    expect(screen.getByRole("radiogroup", { name: "Output" }).getAttribute("data-draft-field")).toBe("postProcessing");
    unmount();
    step({ disabled: true });
    expect(radio(STANDARD).matches(":disabled")).toBe(true);
  });
});
