/**
 * The words of the draft wizard's help panel, all in one place so they can be
 * reviewed together. No React here.
 *
 * Every statement is about what this gateway does, and the numbers that have a
 * source in code are read from it (the memory per core, the longest walltime,
 * the days Anvil keeps unused files), so the text cannot drift from them. Write
 * for a hydrologist: plain words, no names of files, settings or decisions.
 *
 * A topic is the help for one step (its overview) or, on Run settings, for one
 * section of it. `helpTopic` picks it and `helpIndex` lists a step's topics;
 * the panel only draws them.
 */
import { ANVIL_SHARED_MB_PER_CORE } from "@/lib/jobs/compute";
import { MAX_WALLTIME, MAX_WALLTIME_SECONDS } from "@/lib/jobs/types";
import type { DraftStep } from "@/lib/workspace/draft-wizard";
import { RETENTION_DAYS } from "@/lib/workspace/format";

/** The screens the panel helps with: the Start screen, then the wizard's own steps. */
export type HelpStep = "start" | DraftStep;

/** The parts of Run settings that have help of their own. */
export const HELP_SECTIONS = ["about", "period", "variables", "output", "compute"] as const;
export type HelpSection = (typeof HELP_SECTIONS)[number];

export type HelpBlock =
  | { kind: "text"; text: string }
  | { kind: "list"; items: readonly string[] };

export interface HelpTopic {
  /** Stable, for telling topics apart (and for a test). */
  id: string;
  title: string;
  blocks: readonly HelpBlock[];
}

/** What the screen knows that changes what is true to say. */
export interface HelpFacts {
  /** The snapshot's `climatologyAvailable`: the "Also climatology" choice can be used. */
  climatologyAvailable?: boolean;
}

const text = (value: string): HelpBlock => ({ kind: "text", text: value });
const list = (...items: string[]): HelpBlock => ({ kind: "list", items });

const MAX_WALLTIME_HOURS = MAX_WALLTIME_SECONDS / 3600;

const START: HelpTopic = {
  id: "start",
  title: "Choosing a model snapshot",
  blocks: [
    text(
      "A model snapshot is a published WBM simulation, kept together with what it was made from: the model code, the model input it ran on, its init (the run configuration) and the output it produced."
    ),
    text(
      "Your snapshot draft starts from the one you choose, and you can change its settings on the next step. Choosing does not create or save anything yet."
    ),
    list(
      "Search looks in titles, descriptions and keywords. Filters narrows the list further; the chips under the bar show what is applied.",
      "Used before marks a snapshot that one of your recent snapshot drafts is based on. Without a search, when the list fits on one page, those come first.",
      "Details opens a summary with the map, period, resolution and output variables, and a link to the full repository page. Select there, or click the card, to start."
    ),
  ],
};

const RUN: HelpTopic = {
  id: "run",
  title: "Run settings",
  blocks: [
    text(
      "Set the run period, the output variables, the output and the compute for this snapshot draft. The settings start from the snapshot's own values."
    ),
    list(
      "Nothing is saved automatically. Use Save as draft (Save draft once it is stored) or press Ctrl/Cmd+S. If you leave with unsaved changes, you are asked first.",
      "Next only moves to the review. It does not save or submit anything.",
      "A dot on a step in the strip above means something on that step needs attention."
    ),
    text("Point at a section, or click into one, to see help for it here."),
  ],
};

const SECTIONS: Record<HelpSection, HelpTopic> = {
  about: {
    id: "run.about",
    title: "Name and description",
    blocks: [
      text(
        "The name is how this snapshot draft is listed in My snapshot drafts and shown at the top of the page. The description is a note, for you, on what it is for."
      ),
      text(
        "A name is not required to submit: an unnamed draft is listed as Untitled with a short id. A name makes it easier to find."
      ),
      text(
        "If you publish the finished simulation as a snapshot, the publish form starts from this name and description."
      ),
    ],
  },
  period: {
    id: "run.period",
    title: "Run period",
    blocks: [
      text(
        "The first and last day of the simulation. The date pickers stay within the period the snapshot covers, and the line under the dates states the limits that apply to this snapshot."
      ),
      list(
        "Start day: WBM writes its output as one file per year or per month, and a simulation can only start on the first day of a file. That is January 1 for yearly files and the first of a month for monthly files. If your start does not fit, the field offers the nearest date that does. The snapshot's own start is always allowed.",
        "Some snapshots also aggregate their results over multi-year periods from a given year. Then the run must start in or before that year and end on or after its December 31.",
        "If your period lies inside the published one, and your variables and output are published too, Review lists the published files instead of starting a new simulation. A start later than the published start is fine: those years come from the published simulation, whose spinup began earlier."
      ),
    ],
  },
  variables: {
    id: "run.variables",
    title: "Output variables",
    blocks: [
      text(
        "The variables the simulation writes. The list is the snapshot's own. A long list has a search box and groups names that share a base, such as runoff, runoff_ps and runoff_pu."
      ),
      list(
        "Choose at least one: a snapshot draft with none cannot be submitted.",
        "The simulation writes only the variables you choose.",
        "Choosing fewer than the snapshot published does not stop its published results from answering the draft. Their daily files hold every published variable, so they can include more than you chose."
      ),
    ],
  },
  output: {
    id: "run.output",
    title: "Output",
    blocks: [
      text(
        "Daily, monthly and yearly is the output every published snapshot has, and it is the default."
      ),
      list(
        "A snapshot whose init has no post-processing settings cannot change this choice.",
        "No published snapshot holds climatology, so asking for it always means a new simulation."
      ),
    ],
  },
  compute: {
    id: "run.compute",
    title: "Compute",
    blocks: [
      text(
        "The cores and the walltime of the SLURM job on Anvil. Leave a field empty to use the snapshot's recommendation, which is shown in it."
      ),
      list(
        `Cores are for memory. On Anvil's shared partition a core brings ${ANVIL_SHARED_MB_PER_CORE} MB, and memory comes only with cores, so the snapshot recommends the number that gives its simulation enough. With fewer, the simulation may be stopped for running out of memory. You get a warning, and can still submit.`,
        `Left empty, the walltime is the snapshot's recommended time plus 50%, and never more than ${MAX_WALLTIME_HOURS} hours, the longest one job may run. A walltime you set is used as written, up to ${MAX_WALLTIME}.`,
        "If a simulation needs longer than its walltime, it may be stopped when time runs out.",
        `A snapshot whose reference simulation took more than ${MAX_WALLTIME_HOURS} hours cannot use the automatic walltime: shorten the run period or set a walltime yourself.`
      ),
    ],
  },
};

const REVIEW: HelpTopic = {
  id: "review",
  title: "Review and submit",
  blocks: [
    text(
      "Check what will run. Each Edit link takes you back to that setting. Submit stays off while the Submit section lists something to fix, and each item has a Fix link."
    ),
    list(
      "Submit to Anvil saves the draft first, then asks you to confirm what it holds. Confirming starts a SLURM job on Anvil that fetches the snapshot and runs WBM with the OpenGHM toolkit. It spends compute time.",
      "If the snapshot already publishes results for these settings, a Published results card lists the files to download. Run anyway repeats a published result, to check that it reproduces, and asks you to confirm.",
      `The simulation's output stays on Anvil scratch, and the job page shows where. Anvil deletes files that are not used for ${RETENTION_DAYS} days, so copy what you need.`,
      "When the simulation has completed, its job page offers to publish it as a snapshot in the Data Repository. A published snapshot is public and cannot be changed."
    ),
  ],
};

/** "Output", with what is true of climatology on this snapshot: it is offered, or it is not yet. */
function outputTopic({ climatologyAvailable = false }: HelpFacts): HelpTopic {
  const base = SECTIONS.output;
  const [intro, ...rest] = base.blocks;
  const climatology = climatologyAvailable
    ? text(
        "Also climatology adds daily, monthly and yearly climatologies of the run period for each output variable: three files per variable. WBM computes them after the simulation, which takes extra time."
      )
    : text(
        "Also climatology is not available yet: WBM's post-processing time grows with a snapshot's size and period, and the gateway does not plan for it yet."
      );
  return { ...base, blocks: [intro, climatology, ...rest] };
}

/**
 * The help for a step, or, on Run settings, for one of its sections. A section
 * on any other step is ignored: the step's overview is shown.
 */
export function helpTopic(step: HelpStep, section: HelpSection | null = null, facts: HelpFacts = {}): HelpTopic {
  if (step === "start") return START;
  if (step === "review") return REVIEW;
  if (section === "output") return outputTopic(facts);
  return section ? SECTIONS[section] : RUN;
}

/**
 * The topics of a step, in the order the panel's index lists them: on Run
 * settings the overview (section null) and then each section in
 * `HELP_SECTIONS` order. A step with no sections (Start, Review) has none, so
 * its index is empty. Titles are the topics' own.
 */
export function helpIndex(
  step: HelpStep,
  facts: HelpFacts = {}
): { section: HelpSection | null; title: string }[] {
  if (step !== "run") return [];
  return [null, ...HELP_SECTIONS].map((section) => ({ section, title: helpTopic(step, section, facts).title }));
}
