import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { DraftReviewStep } from "@/components/workspace/draft-review-step";
import type { PublishedAnswerState } from "@/lib/workspace/use-published-answer";
import { fromJob, type DraftLocal } from "@/lib/workspace/draft-state";
import { fakeDataset, fakeDraft } from "@/lib/workspace/fixtures";

afterEach(cleanup);

const dataset = fakeDataset({ id: "snap-1" });

const LOCAL: DraftLocal = fromJob(
  fakeDraft("DRAFT", {
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
  const handlers = { onEditStep: vi.fn() };
  render(
    <DraftReviewStep
      datasetId="snap-1"
      datasetTitle="Stored title"
      ctx={{ dataset, snapshotState: "found" }}
      local={LOCAL}
      recommended={dataset.simulation.recommendedCompute}
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

  it("has no form for them: they are summary rows, entered on Run settings", () => {
    review();
    expect(screen.queryByLabelText("Name")).toBeNull();
    expect(screen.queryByLabelText("Description")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(within(row("Name")).getByText("My run")).toBeTruthy();
    expect(within(row("Description")).getByText("A test")).toBeTruthy();
  });

  it("says 'Not named yet', muted, for a draft with no name, and leaves Description out when empty", () => {
    review({ local: { ...LOCAL, name: "  ", description: "" } });
    const note = within(row("Name")).getByText("Not named yet");
    expect(note.className).toContain("text-muted-foreground");
    expect(screen.queryByText("Description", { selector: "dt" })).toBeNull();
  });

  it("nudges, muted and without blocking, to name a draft that has no name, beside the Edit that does it", () => {
    const { onEditStep } = review({ local: { ...LOCAL, name: "  " } });
    const nudge = within(row("Name")).getByText("Add a name so you can find this snapshot draft later.");
    expect(nudge.className).toContain("text-muted-foreground");
    expect(screen.queryByRole("alert")).toBeNull();
    // The submit area is still there and is the caller's: nothing here holds it back.
    expect(screen.getByTestId("submit-area")).toBeTruthy();
    fireEvent.click(within(row("Name")).getByRole("button", { name: "Edit name" }));
    expect(onEditStep).toHaveBeenLastCalledWith("run", "name");
  });

  it("says nothing about naming a draft that has a name", () => {
    review();
    expect(screen.queryByText(/Add a name/)).toBeNull();
  });

  it("sends Edit on each to its input on Run settings", () => {
    const { onEditStep } = review();
    fireEvent.click(screen.getByRole("button", { name: "Edit name" }));
    expect(onEditStep).toHaveBeenLastCalledWith("run", "name");
    fireEvent.click(screen.getByRole("button", { name: "Edit description" }));
    expect(onEditStep).toHaveBeenLastCalledWith("run", "description");
  });

  it("offers Edit on the Name of an unnamed draft", () => {
    const { onEditStep } = review({ local: { ...LOCAL, name: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Edit name" }));
    expect(onEditStep).toHaveBeenLastCalledWith("run", "name");
  });
});

describe("DraftReviewStep: the summary", () => {
  it("is one list: name, description, based on, run period, output variables, output, cores, walltime", () => {
    review();
    expect(screen.getAllByRole("term").map((t) => t.textContent)).toEqual([
      "Name",
      "Description",
      "Based on",
      "Run period",
      "Output variables",
      "Output",
      "Cores",
      "Walltime",
    ]);
    // Nothing is repeated as a card of its own.
    expect(screen.queryByRole("heading", { name: "Model snapshot" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Model input" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Compute" })).toBeNull();
    expect(screen.queryByText("Needs attention")).toBeNull();
  });

  it("names the snapshot by its title, two lines at most, and links it to the repository with no Edit", () => {
    review();
    const based = row("Based on");
    // The snapshot's title, whole in the page, cut by CSS, and on hover.
    const title = within(based).getByText("Fake Snapshot");
    expect(title.getAttribute("title")).toBe("Fake Snapshot");
    expect(title.className).toContain("line-clamp-2");
    // The facts are plain phrases beside it, never a name.
    expect(within(based).getByText("WBM 23.9.0 · 2001 · 0.5°")).toBeTruthy();
    expect(based.textContent).not.toMatch(/Regional|Global/);
    expect(within(based).getByRole("link", { name: /View.*Fake Snapshot.*in the repository/ }).getAttribute("href")).toBe(
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
    const note = within(row("Cores")).getByText("1 core is below the recommended 64: the simulation may run out of memory.");
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

  it("adds the post-processing time to the automatic walltime of a climatology choice, and says so", () => {
    const recommended = { cores: 16, walltime: "15:00", postProcessingWalltime: "1:00:00" };
    const local = (post_processing: "standard" | "climatology") => ({
      ...LOCAL,
      parameters: { ...LOCAL.parameters, post_processing },
      slurm: { cores: null, walltime: null },
    });
    review({ local: local("climatology"), recommended });
    expect(row("Walltime").textContent).toContain("1 h 52 min · model snapshot's recommendation + post-processing + 50%");
    cleanup();
    review({ local: local("standard"), recommended });
    expect(row("Walltime").textContent).toContain("22 min 30 s · model snapshot's recommendation + 50%");
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
    expect(area.previousElementSibling?.textContent).toContain("Walltime");
  });

  it("switches its Edit buttons off while a submit is under way", () => {
    review({ disabled: true });
    const off = (el: Element) => el.matches(":disabled");
    expect(off(screen.getByRole("button", { name: "Edit name" }))).toBe(true);
    expect(off(screen.getByRole("button", { name: "Edit run period" }))).toBe(true);
  });
});

describe("DraftReviewStep: published results", () => {
  const answered: PublishedAnswerState = {
    status: "answered",
    answer: {
      answered: true,
      reasons: [],
      period: { start: "2001-01-01", end: "2001-12-31" },
      run_id: "WBM_test",
      files: [
        {
          group: "daily",
          variable: null,
          year: 2001,
          key: "k",
          url: "https://s3.example.org/openghm/k.nc",
          size: 3_145_728,
        },
      ],
    },
  };

  it("shows only the submit area when nothing is known or nothing answers", () => {
    review({ publishedAnswer: { status: "none" } });
    expect(screen.getByTestId("submit-area")).toBeTruthy();
    expect(screen.queryByText("This simulation has already been run")).toBeNull();
    expect(screen.queryByRole("link", { name: /^Download / })).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows a skeleton, and no submit area, while the results are being looked up", () => {
    review({ publishedAnswer: { status: "loading" } });
    expect(screen.queryByTestId("submit-area")).toBeNull();
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-busy")).toBe("true");
    expect(status.textContent).toContain("Checking whether this is already published");
    expect(screen.queryByText("This simulation has already been run")).toBeNull();
    expect(screen.queryByRole("link", { name: /^Download / })).toBeNull();
  });

  it("replaces the submit card with the results card, and puts the submit area under it", () => {
    review({ publishedAnswer: answered });
    const heading = screen.getByRole("heading", { name: "Published results" });
    const area = screen.getByTestId("submit-area");
    // Below the card, outside the review panel.
    expect(heading.compareDocumentPosition(area) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(area.closest(".divide-y")).toBeNull();
    expect(screen.getByRole("link", { name: "Download daily 2001" }).getAttribute("href")).toBe(
      "https://s3.example.org/openghm/k.nc"
    );
    expect(screen.getByText("3.0 MB")).toBeTruthy();
    // The summary is still there.
    expect(within(row("Run period")).getByText("2001-03-01 → 2001-06-30")).toBeTruthy();
  });

  it("opens with a warning notice above the summary rows when the draft is answered", () => {
    review({ publishedAnswer: answered });
    const notice = screen.getByRole("status");
    const title = within(notice).getByRole("heading", { name: "This simulation has already been run" });
    expect(notice.getAttribute("aria-labelledby")).toBe(title.id);
    expect(notice.textContent).toContain("no need to run it again");
    expect(notice.textContent).toContain("uses compute time on your allocation");
    expect(notice.className).toContain("text-warning");
    // Above the summary, and above the published files.
    const firstRow = screen.getByText("Run period");
    expect(notice.compareDocumentPosition(firstRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      notice.compareDocumentPosition(screen.getByRole("heading", { name: "Published results" })) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("shows no such notice for none, loading or error", () => {
    for (const publishedAnswer of [{ status: "none" }, { status: "loading" }, { status: "error" }] as const) {
      review({ publishedAnswer });
      expect(screen.queryByText("This simulation has already been run")).toBeNull();
      cleanup();
    }
  });

  it("says the years come from the published simulation when the draft starts later than it", () => {
    // LOCAL starts 2001-03-01; the published simulation starts 2001-01-01.
    review({ publishedAnswer: answered });
    expect(screen.getByText(/whose spinup began earlier/)).toBeTruthy();
  });

  it("leaves that out when the draft starts where the published simulation does", () => {
    review({
      publishedAnswer: answered,
      local: { ...LOCAL, parameters: { ...LOCAL.parameters, temporal_range_start: "2001-01-01" } },
    });
    expect(screen.queryByText(/whose spinup began earlier/)).toBeNull();
  });

  it("offers the submit area as usual, with a small note, when the check failed", () => {
    review({ publishedAnswer: { status: "error" } });
    expect(screen.getByTestId("submit-area")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("couldn't check whether this is already published");
    expect(screen.getByRole("status").textContent).toContain("You can still submit it");
    expect(screen.queryByText("This simulation has already been run")).toBeNull();
    expect(screen.queryByRole("link", { name: /^Download / })).toBeNull();
  });
});

describe("DraftReviewStep: output", () => {
  const withOutput = (post_processing: "standard" | "climatology" | null) => ({
    ...LOCAL,
    parameters: { ...LOCAL.parameters, post_processing },
  });

  it("says daily, monthly and yearly for a draft with no choice on a standard snapshot", () => {
    review();
    expect(within(row("Output")).getByText("Daily, monthly and yearly")).toBeTruthy();
  });

  it("adds climatology when the draft chose it, or has none and the snapshot's own is climatology", () => {
    review({ local: withOutput("climatology") });
    expect(within(row("Output")).getByText("Daily, monthly and yearly, and climatology")).toBeTruthy();
    cleanup();
    review({
      local: withOutput(null),
      ctx: { dataset: fakeDataset({ id: "snap-1", postProcessing: "climatology" }), snapshotState: "found" },
    });
    expect(within(row("Output")).getByText("Daily, monthly and yearly, and climatology")).toBeTruthy();
  });

  it("takes the draft's standard over the snapshot's climatology", () => {
    review({
      local: withOutput("standard"),
      ctx: { dataset: fakeDataset({ id: "snap-1", postProcessing: "climatology" }), snapshotState: "found" },
    });
    expect(within(row("Output")).getByText("Daily, monthly and yearly")).toBeTruthy();
  });

  it("sends Edit to the Output control on Run settings", () => {
    const { onEditStep } = review();
    fireEvent.click(screen.getByRole("button", { name: "Edit output" }));
    expect(onEditStep).toHaveBeenLastCalledWith("run", "postProcessing");
  });
});
