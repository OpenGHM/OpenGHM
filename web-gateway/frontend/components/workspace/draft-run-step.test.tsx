import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { JobParameters } from "@/lib/jobs/types";

import { DraftRunStep } from "@/components/workspace/draft-run-step";
import { UNSUPPORTED_REASON } from "@/lib/jobs/compute";
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
  const view = render(
    <DraftRunStep
      ctx={FOUND}
      parameters={PARAMETERS}
      slurm={{ cores: null, walltime: null }}
      recommended={dataset.simulation.recommendedCompute}
      serverErrors={{}}
      startRefusal={null}
      onParametersChange={onParametersChange}
      onSlurmChange={onSlurmChange}
      {...props}
    />
  );
  return { onParametersChange, onSlurmChange, ...view };
}

const start = () => screen.getByLabelText("Start") as HTMLInputElement;
const end = () => screen.getByLabelText("End") as HTMLInputElement;
const checkbox = (name: string | RegExp) => screen.getByRole("checkbox", { name }) as HTMLInputElement;

describe("the draft run step: fields the wizard can focus", () => {
  it("marks each control an Edit link can send focus to", () => {
    step({
      parameters: {
        ...PARAMETERS,
        spatial_domain: { north: 5, south: -5, east: 5, west: -5 },
        custom_params: { a: "1" },
      },
    });
    const marked = (field: string) => document.querySelector(`[data-draft-field="${field}"]`) as HTMLElement;
    expect(marked("start")).toBe(start());
    expect(marked("end")).toBe(end());
    expect(marked("cores")).toBe(screen.getByLabelText("Cores"));
    expect(marked("walltime")).toBe(screen.getByLabelText("Walltime"));
    expect(marked("spatial")).toBe(screen.getByRole("checkbox", { name: /Restrict to a spatial subset/ }));
    expect(marked("custom")).toBe(screen.getByRole("button", { name: "Remove" }));
    // The group: focus goes to its first checkbox.
    expect(marked("variables").tagName).toBe("FIELDSET");
    expect(marked("variables").querySelector("input")).toBe(checkbox("discharge"));
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
    expect(screen.getByText("2001-01-01 → 2001-12-31")).toBeTruthy();
    expect(screen.getByText(/one file per year, so a run must start on January 1/)).toBeTruthy();
    expect(start().getAttribute("aria-invalid")).toBeNull();
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
    const note = document.getElementById(start().getAttribute("aria-describedby")!.split(" ")[0]);
    expect(note?.textContent).toContain("a run must start on January 1");
    fireEvent.click(screen.getByRole("button", { name: "Start on 2001-01-01 instead" }));
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
    expect(screen.getAllByText(/Start on 2001-01-01 instead/)).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Start on 2001-01-01 instead" })).toBeTruthy();
  });

  it("keeps a refusal's text whole when it does not end with the suggestion", () => {
    step({
      ctx: NO_SNAPSHOT,
      startRefusal: { message: "Not a valid start.", suggestion: null },
    });
    expect(screen.getByText("Not a valid start.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /instead/ })).toBeNull();
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
    expect(screen.queryByRole("button", { name: /instead/ })).toBeNull();
  });

  it("says it could not check a model whose rule is unknown, and flags nothing", () => {
    step({
      ctx: { dataset: fakeDataset({ runStartAlignment: null }), snapshotState: "found" },
      parameters: { ...PARAMETERS, temporal_range_start: "2001-03-01" },
    });
    expect(screen.getByText(/couldn't check where this model's runs may start/)).toBeTruthy();
    expect(start().getAttribute("aria-invalid")).toBeNull();
  });

  it("says nothing about a model with no rule", () => {
    step({
      ctx: { dataset: fakeDataset({ runStartAlignment: "none" }), snapshotState: "found" },
      parameters: { ...PARAMETERS, temporal_range_start: "2001-03-01" },
    });
    expect(screen.queryByText(/couldn't check/)).toBeNull();
    expect(screen.queryByText(/one file per/)).toBeNull();
    expect(start().getAttribute("aria-invalid")).toBeNull();
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
    expect(document.getElementById(end().getAttribute("aria-describedby")!)?.textContent).toBe("End is too late.");
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
    expect(screen.getAllByRole("checkbox").map((c) => (c as HTMLInputElement).checked)).toEqual([true, false]);
    expect(screen.getByRole("checkbox", { name: "discharge" })).toBeTruthy();
    expect(screen.getByText(/Output variables \(1\/1\)/)).toBeTruthy();
    expect(screen.getByText(/own list isn't\s+available/)).toBeTruthy();
    expect(screen.queryByText("not in this snapshot")).toBeNull();
    // The compute fields have no recommendation to show.
    expect(screen.getByLabelText("Cores").getAttribute("placeholder")).toBe("Recommended");
  });
});

describe("the draft run step: output variables", () => {
  it("lists the snapshot's variables and keeps the stored order when one is ticked", () => {
    const { onParametersChange } = step({ parameters: { ...PARAMETERS, variables: ["runoff", "streamAge"] } });
    expect(screen.getByText(/Output variables \(2\/3\)/)).toBeTruthy();
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
    fireEvent.click(checkbox("runoff"));
    expect(onParametersChange).toHaveBeenCalledWith({ ...PARAMETERS, variables: ["discharge", "streamAge"] });
  });

  it("keeps a stored variable the snapshot does not list, marks it, and lets it go", () => {
    const { onParametersChange } = step({
      parameters: { ...PARAMETERS, variables: ["discharge", "legacyVar"] },
    });
    expect(screen.getByText(/Output variables \(2\/4\)/)).toBeTruthy();
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
    expect(screen.getByText("discharge").getAttribute("title")).toBe("Discharge (m3/s)");
  });

  it("shows what the server said about the variables", () => {
    step({ serverErrors: { variables: "Unknown variable." } });
    expect(screen.getByText("Unknown variable.")).toBeTruthy();
  });
});

describe("the draft run step: what a submit refuses", () => {
  const subset = { north: 5, south: -5, east: 5, west: -5 };

  it("offers a spatial subset only as switched off", () => {
    step();
    const box = screen.getByRole("checkbox", { name: "Restrict to a spatial subset" }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(box.disabled).toBe(true);
    expect(screen.getByText(UNSUPPORTED_REASON.spatialSubset)).toBeTruthy();
  });

  it("switches off a stored spatial subset", () => {
    const { onParametersChange } = step({ parameters: { ...PARAMETERS, spatial_domain: subset } });
    const box = screen.getByRole("checkbox", { name: "Restrict to a spatial subset" }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(box.disabled).toBe(false);
    expect(screen.getByText(/switch it off to submit/)).toBeTruthy();
    expect(screen.getByText("N5 S-5 E5 W-5")).toBeTruthy();
    fireEvent.click(box);
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
    fireEvent.change(screen.getByLabelText("Cores"), { target: { value: "4" } });
    expect(onSlurmChange).toHaveBeenCalledWith({ cores: 4, walltime: "02:00:00" });
    expect(screen.getByLabelText("Cores").getAttribute("placeholder")).toBe("16 (recommended)");
  });

  it("shows what the server said about cores and walltime", () => {
    step({ serverErrors: { cores: "Too many cores.", walltime: "Too long." } });
    expect(screen.getByText("Cores: Too many cores.")).toBeTruthy();
    expect(screen.getByText("Walltime: Too long.")).toBeTruthy();
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
    expect(off(checkbox("discharge"))).toBe(true);
    expect(off(checkbox("Restrict to a spatial subset"))).toBe(true);
    expect(off(screen.getByLabelText("Cores"))).toBe(true);
    expect(off(screen.getByLabelText("Walltime"))).toBe(true);
    expect(off(screen.getByRole("button", { name: "Remove" }))).toBe(true);
  });
});
