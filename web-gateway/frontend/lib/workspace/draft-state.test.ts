import { describe, expect, it } from "vitest";
import type { Job } from "@/lib/jobs/types";
import {
  buildDraftPatch,
  canonical,
  canonicalKey,
  clientProblem,
  customErrorsFor,
  fieldsForPaths,
  fromJob,
  isDirty,
  refuseCustom,
  refuseGroups,
  refuseStart,
  submitProblems,
  unsavedFields,
  type DraftContext,
  type DraftLocal,
  type ServerRefusals,
} from "@/lib/workspace/draft-state";
import { fakeDataset, fakeDraft } from "@/lib/workspace/fixtures";

// A snapshot with three output variables, 2001 as its coverage, and a model
// that writes one file a year, so a simulation may only start on January 1.
const NAMES = ["discharge", "runoff", "streamAge"];
const dataset = fakeDataset({
  runStartAlignment: "year",
  simulation: {
    ...fakeDataset().simulation,
    temporalCoverage: { start: "2000-01-01", end: "2004-12-31" },
    outputVariables: [
      { name: "discharge", fullName: "Discharge", unit: "m3/s" },
      { name: "runoff", fullName: "Runoff", unit: "mm" },
      { name: "streamAge", fullName: "Stream age", unit: "d" },
    ],
  },
});
const FOUND: DraftContext = { dataset, snapshotState: "found" };
const GONE: DraftContext = { dataset: null, snapshotState: "gone" };
const UNAVAILABLE: DraftContext = { dataset: null, snapshotState: "unavailable" };

const draft = (overrides: Partial<Job> = {}): Job =>
  fakeDraft("DRAFT", {
    parameters: {
      temporal_range_start: "2001-01-01",
      temporal_range_end: "2003-12-31",
      spatial_domain: null,
      variables: [...NAMES],
      custom_params: null,
    },
    slurm_config: { cores: null },
    ...overrides,
  });

/** The local copy of `job` with some of it edited. */
function edited(job: Job, change: Partial<DraftLocal> & { params?: Partial<Job["parameters"]> }): DraftLocal {
  const base = fromJob(job);
  const { params, ...rest } = change;
  return { ...base, ...rest, parameters: { ...base.parameters, ...params } };
}

describe("fromJob", () => {
  it("keeps every stored field, the ones the wizard cannot set included", () => {
    const job = draft({
      about: { name: "Run A", description: "why", creator: [{ name: "Kim" }] },
      parameters: {
        temporal_range_start: "2001-01-01",
        temporal_range_end: "2001-12-31",
        spatial_domain: { north: 1, south: -1, east: 2, west: -2 },
        variables: ["runoff", "mystery"],
        custom_params: { A: "1" },
      },
      // A walltime stored before it went is dropped.
      slurm_config: { cores: 8, walltime: "01:00:00" } as { cores: number | null },
      model_input_id: "other-input",
    });
    const local = fromJob(job);
    expect(local).toEqual({
      name: "Run A",
      description: "why",
      parameters: job.parameters,
      slurm: { cores: 8 },
      modelInputId: "other-input",
    });
    expect(local.parameters).not.toBe(job.parameters);
  });

  it("is empty strings and nulls for a draft with no name, compute or override", () => {
    const local = fromJob(draft());
    expect(local.name).toBe("");
    expect(local.description).toBe("");
    expect(local.slurm).toEqual({ cores: null });
    expect(local.modelInputId).toBeNull();
  });
});

describe("canonical", () => {
  it("trims the text and reads an empty one as none", () => {
    const c = canonical({ ...fromJob(draft()), name: "  Run  ", description: "   " });
    expect(c.name).toBe("Run");
    expect(c.description).toBeNull();
  });

  it("puts the variables in the snapshot's order, names it does not list after them", () => {
    const local = edited(draft(), { params: { variables: ["zeta", "streamAge", "alpha", "discharge"] } });
    expect(canonical(local, NAMES).parameters.variables).toEqual(["discharge", "streamAge", "zeta", "alpha"]);
  });

  it("lists a variable once", () => {
    const local = edited(draft(), { params: { variables: ["runoff", "runoff"] } });
    expect(canonical(local, NAMES).parameters.variables).toEqual(["runoff"]);
  });

  it("keeps the given order when the snapshot is not known", () => {
    const local = edited(draft(), { params: { variables: ["runoff", "discharge"] } });
    expect(canonical(local, []).parameters.variables).toEqual(["runoff", "discharge"]);
  });

  it("reads empty custom parameters as none and ignores their key order", () => {
    const none = edited(draft(), { params: { custom_params: {} } });
    expect(canonical(none).parameters.custom_params).toBeNull();
    const ab = edited(draft(), { params: { custom_params: { A: "1", B: "2" } } });
    const ba = edited(draft(), { params: { custom_params: { B: "2", A: "1" } } });
    expect(canonicalKey(ab, FOUND)).toBe(canonicalKey(ba, FOUND));
  });
});

describe("buildDraftPatch: nothing to save", () => {
  it("is null for a draft as it was opened", () => {
    const job = draft();
    expect(buildDraftPatch(fromJob(job), job, FOUND)).toEqual({ patch: null, withheld: [], errors: {} });
  });

  it("is null when the only difference is how it is written", () => {
    const job = draft({ about: { name: "Run A" }, parameters: { ...draft().parameters, variables: ["runoff", "discharge"] } });
    const local = edited(job, {
      name: "  Run A ",
      description: "  ",
      params: { variables: ["discharge", "runoff"] },
    });
    expect(buildDraftPatch(local, job, FOUND).patch).toBeNull();
  });

  // The property the whole design rests on: opening a draft never saves, for
  // any draft the backend can hold.
  const JOBS: Record<string, Job> = {
    "a plain draft": draft(),
    "a named draft": draft({ about: { name: "Run A", description: "why" } }),
    "a name with spaces and no description": draft({ about: { name: "  Run A  " } }),
    "an about block with more than the wizard shows": draft({
      about: { name: "Run A", keywords: ["a"], creator: [{ name: "Kim" }], license: "MIT" },
    }),
    "variables in another order": draft({
      parameters: { ...draft().parameters, variables: ["streamAge", "discharge"] },
    }),
    "variables the snapshot does not list": draft({
      parameters: { ...draft().parameters, variables: ["discharge", "mystery"] },
    }),
    "no variables": draft({ parameters: { ...draft().parameters, variables: [] } }),
    "a stored spatial subset": draft({
      parameters: { ...draft().parameters, spatial_domain: { north: 5, south: 1, east: 3, west: -3 } },
    }),
    "custom parameters": draft({ parameters: { ...draft().parameters, custom_params: { X: "1" } } }),
    "empty custom parameters": draft({ parameters: { ...draft().parameters, custom_params: {} } }),
    "a legacy start the model would refuse": draft({
      parameters: { ...draft().parameters, temporal_range_start: "2001-03-15" },
    }),
    "a start after the end": draft({
      parameters: { ...draft().parameters, temporal_range_start: "2003-01-01", temporal_range_end: "2001-01-01" },
    }),
    "a cleared date": draft({ parameters: { ...draft().parameters, temporal_range_end: "" } }),
    "cores": draft({ slurm_config: { cores: 8 } }),
    "no cores": draft({ slurm_config: { cores: null } }),
    "a model input override": draft({ model_input_id: "other-input" }),
    "a null about": draft({ about: null }),
  };

  for (const [label, job] of Object.entries(JOBS)) {
    for (const [ctxLabel, ctx] of [
      ["found", FOUND],
      ["gone", GONE],
      ["unavailable", UNAVAILABLE],
    ] as const) {
      it(`is null for ${label} (snapshot ${ctxLabel})`, () => {
        const { patch, withheld } = buildDraftPatch(fromJob(job), job, ctx);
        expect(patch).toBeNull();
        expect(withheld).toEqual([]);
      });
    }
  }
});

describe("buildDraftPatch: each group sends only its own keys", () => {
  const job = draft({ about: { name: "Run A", creator: [{ name: "Kim" }] }, slurm_config: { cores: 8 } });

  it("model input: only model_input_id, null to inherit again", () => {
    const stored = { ...job, model_input_id: "override" };
    const { patch } = buildDraftPatch(edited(stored, { modelInputId: null }), stored, FOUND);
    expect(patch).toEqual({ model_input_id: null });
    expect(patch).toHaveProperty("model_input_id", null);
  });

  it("model input: a value is never sent, the API refuses to set one", () => {
    const { patch } = buildDraftPatch(edited(job, { modelInputId: "other" }), job, FOUND);
    expect(patch).toBeNull();
  });

  it("run settings, parameters: the whole object and nothing else", () => {
    const { patch } = buildDraftPatch(edited(job, { params: { temporal_range_end: "2002-12-31" } }), job, FOUND);
    expect(patch).toEqual({
      parameters: {
        temporal_range_start: "2001-01-01",
        temporal_range_end: "2002-12-31",
        spatial_domain: null,
        variables: NAMES,
        custom_params: null,
      },
    });
  });

  it("run settings, compute: only slurm_config", () => {
    const { patch } = buildDraftPatch(edited(job, { slurm: { cores: 16 } }), job, FOUND);
    expect(Object.keys(patch!)).toEqual(["slurm_config"]);
    expect(patch!.slurm_config).toEqual({ cores: 16 });
  });

  it("name and description: only those two keys, so the other citation fields are left alone", () => {
    const { patch } = buildDraftPatch(edited(job, { name: "Run B", description: "new" }), job, FOUND);
    expect(patch).toEqual({ about: { name: "Run B", description: "new" } });
  });

  it("two groups changed: both are sent, neither carries the other's keys", () => {
    const { patch } = buildDraftPatch(
      edited(job, { name: "Run B", slurm: { cores: 4 } }),
      job,
      FOUND
    );
    expect(Object.keys(patch!).sort()).toEqual(["about", "slurm_config"]);
  });

  it("a stored spatial subset and custom parameters go back unchanged with an edited end date", () => {
    const rich = draft({
      parameters: {
        ...draft().parameters,
        spatial_domain: { north: 5, south: 1, east: 3, west: -3 },
        custom_params: { X: "1" },
      },
    });
    const { patch } = buildDraftPatch(edited(rich, { params: { temporal_range_end: "2002-12-31" } }), rich, FOUND);
    expect(patch!.parameters).toMatchObject({
      spatial_domain: { north: 5, south: 1, east: 3, west: -3 },
      custom_params: { X: "1" },
    });
  });

  it("switching a spatial subset off and removing custom parameters are saved as nulls", () => {
    const rich = draft({
      parameters: { ...draft().parameters, spatial_domain: { north: 5, south: 1, east: 3, west: -3 }, custom_params: { X: "1" } },
    });
    const { patch } = buildDraftPatch(edited(rich, { params: { spatial_domain: null, custom_params: null } }), rich, FOUND);
    expect(patch!.parameters).toMatchObject({ spatial_domain: null, custom_params: null });
  });

  it("an empty name becomes null, which removes the key", () => {
    const { patch } = buildDraftPatch(edited(job, { name: "   " }), job, FOUND);
    expect(patch).toEqual({ about: { name: null, description: null } });
  });

  it("variables are sent in the snapshot's order, whatever order they were ticked in", () => {
    const local = edited(job, { params: { variables: ["streamAge", "discharge"] } });
    const { patch } = buildDraftPatch(local, job, FOUND);
    expect(patch!.parameters!.variables).toEqual(["discharge", "streamAge"]);
  });

  it("a variable the snapshot does not list is kept, after the ones it does", () => {
    const local = edited(job, { params: { variables: ["mystery", "runoff"] } });
    expect(buildDraftPatch(local, job, FOUND).patch!.parameters!.variables).toEqual(["runoff", "mystery"]);
  });

  it("without the snapshot the variables keep the order they have", () => {
    const local = edited(job, { params: { variables: ["streamAge", "discharge"] } });
    expect(buildDraftPatch(local, job, GONE).patch!.parameters!.variables).toEqual(["streamAge", "discharge"]);
  });

  it("an empty variable list, a start after the end and a cleared date are saved, not held back", () => {
    const local = edited(job, {
      params: { variables: [], temporal_range_start: "2003-01-01", temporal_range_end: "" },
    });
    const { patch, withheld } = buildDraftPatch(local, job, FOUND);
    expect(withheld).toEqual([]);
    expect(patch!.parameters).toMatchObject({
      variables: [],
      temporal_range_start: "2003-01-01",
      temporal_range_end: "",
    });
  });
});

describe("buildDraftPatch: a start the model would refuse", () => {
  const job = draft();

  it("sends the saved start in its place, saves the rest, and lists start as withheld", () => {
    const local = edited(job, { params: { temporal_range_start: "2001-03-15", temporal_range_end: "2002-12-31" } });
    const { patch, withheld } = buildDraftPatch(local, job, FOUND);
    expect(patch!.parameters).toMatchObject({ temporal_range_start: "2001-01-01", temporal_range_end: "2002-12-31" });
    expect(withheld).toEqual(["start"]);
  });

  it("sends nothing when the start was the only change, and still lists it", () => {
    const { patch, withheld } = buildDraftPatch(
      edited(job, { params: { temporal_range_start: "2001-03-15" } }),
      job,
      FOUND
    );
    expect(patch).toBeNull();
    expect(withheld).toEqual(["start"]);
  });

  it("sends an aligned start", () => {
    const { patch, withheld } = buildDraftPatch(
      edited(job, { params: { temporal_range_start: "2002-01-01" } }),
      job,
      FOUND
    );
    expect(patch!.parameters!.temporal_range_start).toBe("2002-01-01");
    expect(withheld).toEqual([]);
  });

  it("does not judge a start it cannot check: no snapshot, or no rule", () => {
    const local = edited(job, { params: { temporal_range_start: "2001-03-15" } });
    expect(buildDraftPatch(local, job, GONE).patch!.parameters!.temporal_range_start).toBe("2001-03-15");
    expect(buildDraftPatch(local, job, UNAVAILABLE).withheld).toEqual([]);
    const noRule: DraftContext = { dataset: { ...dataset, runStartAlignment: "none" }, snapshotState: "found" };
    expect(buildDraftPatch(local, job, noRule).withheld).toEqual([]);
  });

  it("does not hold back a stored start it would refuse when other things are edited", () => {
    const legacy = draft({ parameters: { ...draft().parameters, temporal_range_start: "2001-03-15" } });
    const local = edited(legacy, { params: { temporal_range_end: "2002-12-31" } });
    const { patch, withheld } = buildDraftPatch(local, legacy, FOUND);
    expect(patch!.parameters).toMatchObject({ temporal_range_start: "2001-03-15", temporal_range_end: "2002-12-31" });
    expect(withheld).toEqual([]);
  });

  it("withholds a start the server refused, but only that exact value", () => {
    const refusals: ServerRefusals = refuseStart({}, { value: "2001-03-15", message: "Not that day.", suggestion: "2001-01-01" });
    const noRule: DraftContext = { dataset: null, snapshotState: "unavailable" };
    const refused = edited(job, { params: { temporal_range_start: "2001-03-15", temporal_range_end: "2002-12-31" } });
    const out = buildDraftPatch(refused, job, noRule, refusals);
    expect(out.patch!.parameters!.temporal_range_start).toBe("2001-01-01");
    expect(out.withheld).toEqual(["start"]);
    expect(out.errors.start).toBe("Not that day.");

    const other = edited(job, { params: { temporal_range_start: "2001-03-16" } });
    const next = buildDraftPatch(other, job, noRule, refusals);
    expect(next.patch!.parameters!.temporal_range_start).toBe("2001-03-16");
    expect(next.withheld).toEqual([]);
  });
});

describe("buildDraftPatch: cores", () => {
  const job = draft({ slurm_config: { cores: 8 } });

  it("sends null as null, to go back to the snapshot's recommendation", () => {
    const { patch } = buildDraftPatch(edited(job, { slurm: { cores: null } }), job, FOUND);
    expect(patch!.slurm_config).toEqual({ cores: null });
    expect(patch!.slurm_config).toHaveProperty("cores", null);
  });

  it("leaves out cores that fail validation and lists them", () => {
    for (const cores of [0, 129, 2.5, -1]) {
      const { patch, withheld } = buildDraftPatch(edited(job, { slurm: { cores } }), job, FOUND);
      expect(patch).toBeNull();
      expect(withheld).toEqual(["cores"]);
    }
  });

  it("never sends a walltime, whatever a stored draft holds", () => {
    const stored = draft({ slurm_config: { cores: null, walltime: "99:00:00" } as { cores: number | null } });
    expect(fromJob(stored).slurm).toEqual({ cores: null });
    const { patch, withheld } = buildDraftPatch(edited(stored, { slurm: { cores: 4 } }), stored, FOUND);
    expect(patch).toEqual({ slurm_config: { cores: 4 } });
    expect(patch!.slurm_config).not.toHaveProperty("walltime");
    expect(withheld).toEqual([]);
  });
});

describe("buildDraftPatch: a group the server refused", () => {
  const job = draft({ slurm_config: { cores: 8 } });
  const local = edited(job, { slurm: { cores: 16 }, name: "Run B" });
  const sent = buildDraftPatch(local, job, FOUND).patch!;

  it("is withheld, with the server's words, while its value is the refused one; the others still go", () => {
    const refusals = refuseGroups({}, sent, { message: "Too many.", paths: ["slurm_config.cores"] });
    const out = buildDraftPatch(local, job, FOUND, refusals);
    expect(out.patch).toEqual({ about: { name: "Run B", description: null } });
    expect(out.withheld).toEqual(["cores"]);
    expect(out.errors).toEqual({ cores: "Too many." });
  });

  it("is sent again once its value changes", () => {
    const refusals = refuseGroups({}, sent, { message: "Too many.", paths: ["slurm_config.cores"] });
    const changed = edited(job, { slurm: { cores: 12 } });
    const out = buildDraftPatch(changed, job, FOUND, refusals);
    expect(out.patch).toEqual({ slurm_config: { cores: 12 } });
    expect(out.withheld).toEqual([]);
  });

  it("an answer that names no field refuses every group that was sent", () => {
    const refusals = refuseGroups({}, sent, { message: "No." });
    const out = buildDraftPatch(local, job, FOUND, refusals);
    expect(out.patch).toBeNull();
    expect(out.withheld).toEqual(["cores", "name", "description"]);
  });

  it("invalid_about refuses the about group only", () => {
    const refusals = refuseGroups({}, sent, { message: "Bad about.", code: "invalid_about" });
    const out = buildDraftPatch(local, job, FOUND, refusals);
    expect(out.patch).toEqual({ slurm_config: { cores: 16 } });
    expect(out.withheld).toEqual(["name", "description"]);
  });
});

describe("buildDraftPatch: custom parameters the server refused", () => {
  const job = draft({ parameters: { ...draft().parameters, custom_params: { "wbmParam.Infiltration": "HBV" } } });
  const local = edited(job, {
    params: {
      temporal_range_end: "2002-12-31",
      custom_params: { "wbmParam.Infiltration": "HBV", "wbmParam.alpha": "abc", Glaciers: "" },
    },
  });
  const sent = buildDraftPatch(local, job, FOUND).patch!;
  const errors = { "wbmParam.alpha": "Enter a number." };
  const refusals = refuseCustom({}, sent, { message: "Some model parameters are not valid.", errors });

  it("sends the rest of the parameters, with the refused key left out, and withholds only custom", () => {
    expect(sent.parameters!.custom_params).toEqual({
      Glaciers: "",
      "wbmParam.Infiltration": "HBV",
      "wbmParam.alpha": "abc",
    });
    const out = buildDraftPatch(local, job, FOUND, refusals);
    expect(out.patch!.parameters).toMatchObject({
      temporal_range_end: "2002-12-31",
      custom_params: { Glaciers: "", "wbmParam.Infiltration": "HBV" },
    });
    expect(out.withheld).toEqual(["custom"]);
    expect(out.errors).toEqual({ custom: "Some model parameters are not valid." });
  });

  it("puts the saved value of a refused key back, so an edit of a saved key is not half sent", () => {
    const edit = edited(job, { params: { custom_params: { "wbmParam.Infiltration": "bogus" } } });
    const refused = refuseCustom({}, { parameters: edit.parameters }, {
      message: "Not valid.",
      errors: { "wbmParam.Infiltration": "Choose FrAMES or HBV." },
    });
    const out = buildDraftPatch(edit, job, FOUND, refused);
    // The saved value is what the patch would carry, so there is nothing to send.
    expect(out.patch).toBeNull();
    expect(out.withheld).toEqual(["custom"]);
  });

  it("says what is wrong at each key while its value is the refused one", () => {
    expect(customErrorsFor(refusals, local)).toEqual(errors);
    const fixed = edited(job, { params: { custom_params: { "wbmParam.alpha": "7" } } });
    expect(customErrorsFor(refusals, fixed)).toEqual({});
    expect(buildDraftPatch(fixed, job, FOUND, refusals).withheld).toEqual([]);
  });

  it("sends the key again once its value changes", () => {
    const fixed = edited(job, { params: { custom_params: { "wbmParam.alpha": "7" } } });
    const out = buildDraftPatch(fixed, job, FOUND, refusals);
    expect(out.patch!.parameters!.custom_params).toEqual({ "wbmParam.alpha": "7" });
  });

  it("keeps earlier refused keys when another is refused, so they are not sent in turn for ever", () => {
    const next = edited(job, { params: { custom_params: { "wbmParam.alpha": "abc", "wbmParam.maxRffStorage": "-1" } } });
    const again = refuseCustom(refusals, buildDraftPatch(next, job, FOUND, refusals).patch ?? { parameters: next.parameters }, {
      message: "Some model parameters are not valid.",
      errors: { "wbmParam.maxRffStorage": "At least 0." },
    });
    expect(Object.keys(again.custom!.errors).sort()).toEqual(["wbmParam.alpha", "wbmParam.maxRffStorage"]);
    expect(customErrorsFor(again, next)).toEqual({
      "wbmParam.alpha": "Enter a number.",
      "wbmParam.maxRffStorage": "At least 0.",
    });
  });

  it("an answer that names no key of the patch refuses the parameters group as a whole", () => {
    const whole = refuseCustom({}, sent, { message: "No.", errors: { "not.sent": "x" } });
    expect(whole.custom).toBeUndefined();
    const out = buildDraftPatch(local, job, FOUND, whole);
    expect(out.withheld).toContain("custom");
    expect(out.patch).toBeNull();
  });
});

describe("fieldsForPaths", () => {
  it("places a validation error's path on the field", () => {
    expect(fieldsForPaths(["slurm_config.cores"])).toEqual(["cores"]);
    expect(fieldsForPaths(["parameters.temporal_range_end"])).toEqual(["end"]);
    expect(fieldsForPaths(["parameters.variables.0"])).toEqual(["variables"]);
    expect(fieldsForPaths(["about.name", "model_input_id"])).toEqual(["modelInput", "name"]);
    expect(fieldsForPaths(["parameters.post_processing"])).toEqual(["postProcessing"]);
  });

  it("places a path that names a whole group on all its fields, and one that names nothing of ours on none", () => {
    expect(fieldsForPaths(["slurm_config"])).toEqual(["cores"]);
    expect(fieldsForPaths(["parameters"])).toEqual([
      "start",
      "end",
      "variables",
      "spatial",
      "custom",
      "postProcessing",
    ]);
    expect(fieldsForPaths(["slug"])).toEqual([]);
    expect(fieldsForPaths([])).toEqual([]);
  });
});

describe("clientProblem", () => {
  it("says why a start or cores are not saved", () => {
    const local = edited(draft(), {
      params: { temporal_range_start: "2001-03-15" },
      slurm: { cores: 0 },
    });
    expect(clientProblem("start", local, FOUND)).toMatch(/January 1/);
    expect(clientProblem("cores", local, FOUND)).toMatch(/1 to 128/);
    expect(clientProblem("name", local, FOUND)).toBeNull();
  });
});

describe("submitProblems", () => {
  const ok = draft();
  const quiet = { withheld: [], saving: false } as const;
  const problems = (local: DraftLocal, ctx = FOUND, blocked: string | null = null, save: Parameters<typeof submitProblems>[3] = quiet) =>
    submitProblems(local, ctx, blocked, save);

  it("lists nothing for a draft that may be submitted", () => {
    expect(problems(fromJob(ok))).toEqual([]);
  });

  describe("the snapshot's multi-year aggregation", () => {
    // 2000-01-01 .. 2004-12-31 here; aggregation starts in 2001, so a simulation must
    // start in or before 2001 and end on or after 2001-12-31.
    const aggregated: DraftContext = { snapshotState: "found", dataset: { ...dataset, aggregationStartYear: 2001 } };

    it("puts an end that is too early on the End field, at the run step", () => {
      const local = edited(ok, { params: { temporal_range_start: "2000-01-01", temporal_range_end: "2000-12-31" } });
      expect(problems(local, aggregated)).toEqual([
        {
          field: "end",
          step: "run",
          message:
            "This snapshot's model also aggregates its results over multi-year periods that begin in 2001, so a simulation must end on or after 2001-12-31 (allowed: 2001-12-31 to 2004-12-31).",
        },
      ]);
    });

    it("puts a start that is too late on the Start field", () => {
      const local = edited(ok, { params: { temporal_range_start: "2002-01-01", temporal_range_end: "2003-12-31" } });
      const found = problems(local, aggregated);
      expect(found.map((p) => p.field)).toEqual(["start"]);
      expect(found[0].message).toContain("a simulation can start no later than 2001-12-31");
    });

    it("lists nothing for dates that reach the year, or when the snapshot has no window", () => {
      expect(problems(fromJob(ok), aggregated)).toEqual([]); // 2001-01-01 .. 2003-12-31
      const short = edited(ok, { params: { temporal_range_end: "2001-06-30" } });
      expect(problems(short, FOUND)).toEqual([]); // aggregationStartYear absent
      expect(problems(short, aggregated)).toHaveLength(1);
    });

    it("is saved, not withheld: an edit may hold dates only a submit refuses", () => {
      const local = edited(ok, { params: { temporal_range_start: "2001-01-01", temporal_range_end: "2001-06-30" } });
      expect(buildDraftPatch(local, ok, aggregated).withheld).toEqual([]);
    });
  });

  describe("a run estimated to take longer than one simulation may", () => {
    const withWalltime = (walltime: string, postProcessingWalltime?: string): DraftContext => ({
      snapshotState: "found",
      dataset: {
        ...dataset,
        simulation: {
          ...dataset.simulation,
          recommendedCompute: { cores: 16, walltime, ...(postProcessingWalltime ? { postProcessingWalltime } : {}) },
        },
      },
    });

    it("lists nothing for a reference run longer than one job, so long as the estimate fits in two weeks", () => {
      expect(problems(fromJob(ok), withWalltime("111:30:00"))).toEqual([]);
      expect(problems(fromJob(ok), withWalltime("336:00:00"))).toEqual([]); // 336 h exactly
    });

    it("is a problem of the whole draft above two weeks: the recommendation as it is, not capped at one job", () => {
      const [problem, ...rest] = problems(fromJob(ok), withWalltime("336:00:01"));
      expect(rest).toEqual([]);
      expect(problem).toMatchObject({ step: "run" });
      expect(problem.field).toBeUndefined();
      expect(problem.message).toBe(
        "This simulation is estimated to take about 336 h (the reference run), over the 2-week limit for one simulation."
      );
    });

    it("counts the post-processing of a climatology run, and offers to turn it off when that is enough", () => {
      const ctx = withWalltime("320:00:00", "30:00:00");
      expect(problems(edited(ok, { params: { post_processing: "standard" } }), ctx)).toEqual([]);
      const [problem] = problems(edited(ok, { params: { post_processing: "climatology" } }), ctx);
      expect(problem.message).toBe(
        "This simulation is estimated to take about 350 h (the reference run and its post-processing), over the 2-week limit for one simulation. Turn post-processing off to run it."
      );
    });

    it("is not a problem when the post-processing is not measured", () => {
      expect(problems(edited(ok, { params: { post_processing: "climatology" } }), withWalltime("320:00:00"))).toEqual([]);
    });
  });

  it("lists nothing without the snapshot, for the cases that need it: the backend decides", () => {
    expect(problems(fromJob(ok), UNAVAILABLE)).toEqual([]);
  });

  it("the user's permission: the reason, for the whole draft", () => {
    expect(problems(fromJob(ok), FOUND, "Ask an administrator.")).toEqual([
      { step: "review", message: "Ask an administrator." },
    ]);
  });

  it("the snapshot is gone", () => {
    const [problem, ...rest] = problems(fromJob(ok), GONE);
    expect(rest).toEqual([]);
    expect(problem).toMatchObject({ step: "run" });
    expect(problem.field).toBeUndefined();
    expect(problem.message).toMatch(/no longer in the repository/);
  });

  it("a snapshot that could not be fetched is not a problem", () => {
    expect(problems(fromJob(ok), UNAVAILABLE)).toEqual([]);
  });

  it("a value that is not saved, by field, at the step that edits it", () => {
    const out = problems(fromJob(ok), FOUND, null, { withheld: ["cores", "name"], saving: false });
    expect(out).toEqual([
      { field: "cores", step: "run", message: "Cores isn't saved yet. Fix it to continue." },
      { field: "name", step: "run", message: "Name isn't saved yet. Fix it to continue." },
    ]);
  });

  it("a start after the end, on the end date", () => {
    const local = edited(ok, { params: { temporal_range_start: "2003-01-01", temporal_range_end: "2001-12-31" } });
    expect(problems(local)).toEqual([
      { field: "end", step: "run", message: "The end date is before the start date." },
    ]);
  });

  it("no output variable", () => {
    expect(problems(edited(ok, { params: { variables: [] } }))).toEqual([
      { field: "variables", step: "run", message: "Choose at least one output variable." },
    ]);
  });

  it("a variable the toolkit cannot take", () => {
    const [problem] = problems(edited(ok, { params: { variables: ["discharge", "bad name"] } }));
    expect(problem).toMatchObject({ field: "variables", step: "run" });
    expect(problem.message).toMatch(/letters, digits and underscores/);
  });

  it("a date that does not exist, or none", () => {
    const out = problems(edited(ok, { params: { temporal_range_start: "2001-02-30", temporal_range_end: "" } }));
    expect(out).toEqual([
      { field: "start", step: "run", message: "Choose a start date that exists." },
      { field: "end", step: "run", message: "Choose an end date that exists." },
    ]);
  });

  it("a start the model refuses, even a stored one that is saved", () => {
    const legacy = draft({ parameters: { ...ok.parameters, temporal_range_start: "2001-03-15" } });
    const [problem, ...rest] = problems(fromJob(legacy));
    expect(rest).toEqual([]);
    expect(problem).toMatchObject({ field: "start", step: "run" });
    expect(problem.message).toMatch(/January 1/);
  });

  it("names a field once, with the most specific reason", () => {
    const local = edited(ok, { params: { temporal_range_start: "2001-03-15" } });
    const out = problems(local, FOUND, null, { withheld: ["start"], saving: false });
    expect(out.filter((p) => p.field === "start")).toHaveLength(1);
    expect(out[0].message).toMatch(/January 1/);
  });

  it("a different model input", () => {
    const [problem] = problems(edited(ok, { modelInputId: "other" }));
    expect(problem).toMatchObject({ field: "modelInput", step: "run" });
  });

  it("a spatial subset, unless it is the snapshot's own domain", () => {
    const subset = edited(ok, { params: { spatial_domain: { north: 5, south: 1, east: 3, west: -3 } } });
    expect(problems(subset)).toEqual([
      { field: "spatial", step: "run", message: "A spatial subset can't run yet. Switch it off to submit." },
    ]);
    const whole = edited(ok, { params: { spatial_domain: { north: 10, south: -10, east: 10, west: -10 } } });
    expect(problems(whole)).toEqual([]);
    // Without the snapshot there is nothing to compare with.
    expect(problems(whole, UNAVAILABLE)).toHaveLength(1);
  });

  it("custom parameters are no longer refused: the backend checks them", () => {
    expect(problems(edited(ok, { params: { custom_params: { A: "1" } } }))).toEqual([]);
    expect(problems(edited(ok, { params: { custom_params: {} } }))).toEqual([]);
  });

  it("a custom parameter the server refused is not saved, so a submit waits for it", () => {
    expect(
      problems(edited(ok, { params: { custom_params: { A: "1" } } }), FOUND, null, { withheld: ["custom"], saving: false })
    ).toEqual([{ field: "custom", step: "run", message: "Model parameters isn't saved yet. Fix it to continue." }]);
  });

  it("still saving, last", () => {
    const out = problems(edited(ok, { params: { variables: [] } }), FOUND, "Verify your email.", { withheld: [], saving: true });
    expect(out.map((p) => p.message)).toEqual([
      "Verify your email.",
      "Choose at least one output variable.",
      "Still saving your changes.",
    ]);
    expect(out[2]).toEqual({ step: "review", message: "Still saving your changes." });
  });
});

describe("isDirty", () => {
  const baseline = draft();

  it("is false for the baseline itself and for a copy of it", () => {
    expect(isDirty(fromJob(baseline), baseline, FOUND)).toBe(false);
  });

  it("is true for any field that differs", () => {
    expect(isDirty(edited(baseline, { name: "Run A" }), baseline, FOUND)).toBe(true);
    expect(isDirty(edited(baseline, { description: "why" }), baseline, FOUND)).toBe(true);
    expect(isDirty(edited(baseline, { params: { temporal_range_end: "2002-12-31" } }), baseline, FOUND)).toBe(true);
    expect(isDirty(edited(baseline, { params: { variables: ["runoff"] } }), baseline, FOUND)).toBe(true);
    expect(isDirty(edited(baseline, { slurm: { cores: 8 } }), baseline, FOUND)).toBe(true);
    expect(isDirty(edited(baseline, { params: { post_processing: "climatology" } }), baseline, FOUND)).toBe(true);
  });

  it("does not count an absent post_processing and null as different", () => {
    expect(isDirty(edited(baseline, { params: { post_processing: null } }), baseline, FOUND)).toBe(false);
    expect(isDirty(edited(baseline, { params: { post_processing: undefined } }), baseline, FOUND)).toBe(false);
  });

  it("does not count what canonical form ignores: blanks around text, variables in another order", () => {
    // Typing a space into the empty name, or choosing the variables in a
    // different order, leaves nothing that would be saved.
    expect(isDirty(edited(baseline, { name: "   " }), baseline, FOUND)).toBe(false);
    expect(isDirty(edited(baseline, { params: { variables: [...NAMES].reverse() } }), baseline, FOUND)).toBe(false);
  });

  it("goes back to false when an edit is undone", () => {
    const named = edited(baseline, { name: "Run A" });
    expect(isDirty(named, baseline, FOUND)).toBe(true);
    expect(isDirty({ ...named, name: "" }, baseline, FOUND)).toBe(false);
  });

  it("agrees with unsavedFields: dirty exactly when some field differs", () => {
    for (const local of [fromJob(baseline), edited(baseline, { name: "x" }), edited(baseline, { name: " " })]) {
      expect(isDirty(local, baseline, FOUND)).toBe(unsavedFields(local, baseline, FOUND).length > 0);
    }
  });
});

describe("unsavedFields", () => {
  const saved = draft();

  it("is empty when the server holds what is on screen", () => {
    expect(unsavedFields(fromJob(saved), saved, FOUND)).toEqual([]);
  });

  it("names each differing field, in the wizard's order", () => {
    const local = edited(saved, {
      name: "Run A",
      description: "why",
      slurm: { cores: 4 },
      params: {
        temporal_range_start: "2002-01-01",
        temporal_range_end: "2002-12-31",
        variables: ["runoff"],
        spatial_domain: { north: 1, south: -1, east: 2, west: -2 },
        custom_params: { A: "1" },
        post_processing: "climatology",
      },
      modelInputId: "other",
    });
    expect(unsavedFields(local, saved, FOUND)).toEqual([
      "modelInput",
      "start",
      "end",
      "variables",
      "spatial",
      "custom",
      "postProcessing",
      "cores",
      "name",
      "description",
    ]);
  });

  it("lists a value the patch would withhold, because it is not on the server", () => {
    // 2001-07-01 does not suit a yearly model: the patch leaves it out.
    const local = edited(saved, { params: { temporal_range_start: "2001-07-01" } });
    expect(buildDraftPatch(local, saved, FOUND).withheld).toEqual(["start"]);
    expect(unsavedFields(local, saved, FOUND)).toEqual(["start"]);
  });
});

describe("post_processing: the Post-processing choice", () => {
  const job = draft();

  it("is not sent while nobody chose: the parameters carry no post_processing key", () => {
    const { patch } = buildDraftPatch(edited(job, { params: { temporal_range_end: "2002-12-31" } }), job, FOUND);
    expect(patch!.parameters).not.toHaveProperty("post_processing");
    expect(canonical(fromJob(job)).parameters).not.toHaveProperty("post_processing");
  });

  it("is sent inside parameters, whole, once chosen, and is a change that is not yet saved", () => {
    const local = edited(job, { params: { post_processing: "climatology" } });
    const { patch, withheld } = buildDraftPatch(local, job, FOUND);
    expect(patch).toEqual({
      parameters: {
        temporal_range_start: "2001-01-01",
        temporal_range_end: "2003-12-31",
        spatial_domain: null,
        variables: NAMES,
        custom_params: null,
        post_processing: "climatology",
      },
    });
    expect(withheld).toEqual([]);
    expect(unsavedFields(local, job, FOUND)).toEqual(["postProcessing"]);
    expect(isDirty(local, job, FOUND)).toBe(true);
  });

  it("stores the snapshot's own value when that is what was picked", () => {
    const { patch } = buildDraftPatch(edited(job, { params: { post_processing: "standard" } }), job, FOUND);
    expect(patch!.parameters).toHaveProperty("post_processing", "standard");
  });

  it("is saved once the server holds it, and a change back to the other value is dirty again", () => {
    const stored = draft({
      parameters: { ...job.parameters, post_processing: "climatology" },
    });
    expect(unsavedFields(fromJob(stored), stored, FOUND)).toEqual([]);
    expect(buildDraftPatch(fromJob(stored), stored, FOUND).patch).toBeNull();
    const back = edited(stored, { params: { post_processing: "standard" } });
    expect(unsavedFields(back, stored, FOUND)).toEqual(["postProcessing"]);
  });

  it("post_processing_unavailable withholds the field, with the server's words, until it changes", () => {
    const local = edited(job, { params: { post_processing: "climatology" } });
    const sent = buildDraftPatch(local, job, FOUND).patch!;
    const refusals = refuseGroups({}, sent, {
      message: "This snapshot's init has no post-processing settings.",
      code: "post_processing_unavailable",
    });
    const out = buildDraftPatch(local, job, FOUND, refusals);
    expect(out.patch).toBeNull();
    expect(out.withheld).toEqual(["postProcessing"]);
    expect(out.errors).toEqual({ postProcessing: "This snapshot's init has no post-processing settings." });
    const changed = edited(job, { params: { post_processing: "standard" } });
    expect(buildDraftPatch(changed, job, FOUND, refusals).patch).not.toBeNull();
  });

  it("climatology_unavailable withholds the field, with the server's words, until it changes", () => {
    const local = edited(job, { params: { post_processing: "climatology" } });
    const sent = buildDraftPatch(local, job, FOUND).patch!;
    const refusals = refuseGroups({}, sent, {
      message: "Climatology is not available yet.",
      code: "climatology_unavailable",
    });
    const out = buildDraftPatch(local, job, FOUND, refusals);
    expect(out.patch).toBeNull();
    expect(out.withheld).toEqual(["postProcessing"]);
    expect(out.errors).toEqual({ postProcessing: "Climatology is not available yet." });
    const changed = edited(job, { params: { post_processing: "standard" } });
    expect(buildDraftPatch(changed, job, FOUND, refusals).patch).not.toBeNull();
  });
});
