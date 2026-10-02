import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ActionResult, Job } from "@/lib/jobs/types";

vi.mock("next/navigation", () => ({ usePathname: () => "/workspace/job-1" }));

import { DraftSubmitCard } from "@/components/workspace/draft-submit-card";
import type { SubmitProblem } from "@/lib/workspace/draft-state";
import type { FlushResult } from "@/lib/workspace/use-draft-autosave";
import { fakeSimulation } from "@/lib/workspace/fixtures";

// What the server holds after the flush: not what the page's props said.
const SAVED = fakeSimulation("DRAFT", {
  id: "job-1",
  dataset_title: "Saved snapshot title",
  parameters: {
    temporal_range_start: "2001-03-01",
    temporal_range_end: "2001-06-30",
    spatial_domain: null,
    variables: ["discharge", "runoff"],
    custom_params: null,
  },
  slurm_config: { cores: 8, walltime: "02:00:00" },
});
const SUBMITTED = fakeSimulation("PENDING", { id: "job-1" });
const RECOMMENDED = { cores: 16, walltime: "15:00" };

const flush = vi.fn<() => Promise<FlushResult>>();
const suspend = vi.fn();
const submit = vi.fn<(jobId: string) => Promise<ActionResult<Job>>>();
const onSubmitted = vi.fn();
const onSubmitFailed = vi.fn();
const onSubmittingChange = vi.fn();
/** The order the effects happened in. */
let calls: string[] = [];

beforeEach(() => {
  calls = [];
  flush.mockImplementation(async () => {
    calls.push("flush");
    return { ok: true, job: SAVED, withheld: [] };
  });
  suspend.mockImplementation(() => void calls.push("suspend"));
  submit.mockImplementation(async () => {
    calls.push("submit");
    return { ok: true, data: SUBMITTED };
  });
  onSubmittingChange.mockImplementation((on: boolean) => void calls.push(`submitting:${on}`));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function card(props: Partial<React.ComponentProps<typeof DraftSubmitCard>> = {}) {
  return render(
    <DraftSubmitCard
      jobId="job-1"
      problems={[]}
      lastSubmitError={null}
      recommended={RECOMMENDED}
      flush={flush}
      suspend={suspend}
      submit={submit}
      onSubmitted={onSubmitted}
      onSubmitFailed={onSubmitFailed}
      onSubmittingChange={onSubmittingChange}
      {...props}
    />
  );
}

const submitButton = () => screen.getByRole("button", { name: "Submit to Anvil" }) as HTMLButtonElement;
const dialog = () => screen.getByRole("alertdialog");
const confirmButton = () => within(dialog()).getByRole("button", { name: "Submit to Anvil" });

/** Click Submit and wait for the confirmation. */
async function openDialog() {
  fireEvent.click(submitButton());
  await screen.findByRole("alertdialog");
}

describe("DraftSubmitCard: what it says", () => {
  it("says the draft saves itself", () => {
    card();
    expect(screen.getByText(/Your draft saves automatically/)).toBeTruthy();
    expect(submitButton().disabled).toBe(false);
  });

  it("is off while something needs attention, and points at the list", () => {
    const problems: SubmitProblem[] = [
      { step: "review", message: "You are not permitted to run simulations yet." },
      { field: "start", step: "run", message: "Choose a start date that exists." },
    ];
    card({ problems });
    expect(submitButton().disabled).toBe(true);
    expect(screen.getByText("Fix the 2 items under Needs attention to submit.")).toBeTruthy();
    expect(submitButton().getAttribute("aria-describedby")).toBeTruthy();
    fireEvent.click(submitButton());
    expect(flush).not.toHaveBeenCalled();
  });

  it("uses the singular for one item", () => {
    card({ problems: [{ step: "review", message: "x" }] });
    expect(screen.getByText("Fix the item under Needs attention to submit.")).toBeTruthy();
  });

  it("shows why the last submit did not reach Anvil, until this page tries again", async () => {
    card({ lastSubmitError: { code: "anvil_unreachable", message: "Anvil could not be reached.", at: "2026-10-01T00:00:00Z" } });
    expect(screen.getByRole("alert").textContent).toContain(
      "The last submit didn't go through: Anvil could not be reached."
    );

    submit.mockResolvedValueOnce({ ok: false, reason: "error", message: "sbatch said no", code: "sbatch_rejected" });
    await openDialog();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("sbatch said no"));
    expect(screen.getByRole("alert").textContent).not.toContain("Anvil could not be reached");
  });
});

describe("DraftSubmitCard: long refusals", () => {
  const LONG =
    "Anvil refused the requested run time: it is over the limit for one job (96 h). Shorten the run period or set a shorter walltime. SLURM said: QOSMaxWallDurationPerJobLimit sbatch: error: Batch job submission failed: Job violates accounting/QOS policy (job submit limit, user's size and/or time limits). Your draft is unchanged.";

  it("wraps the stored reason of the last submit instead of overflowing", () => {
    card({ lastSubmitError: { code: "sbatch_rejected", message: LONG, at: "2026-10-02T00:00:00Z" } });
    const text = screen.getByText(/The last submit didn't go through: Anvil refused the requested run time/);
    expect(text.textContent).toContain("QOSMaxWallDurationPerJobLimit");
    expect(text.className).toContain("break-words");
    expect(text.className).toContain("min-w-0");
  });

  it("shows the backend's sentence for walltime_over_limit as it is", async () => {
    const message =
      "This model snapshot's reference run took about 111 h 30 min, and one job may use at most 96 h. Shorten the run period, or set a walltime yourself.";
    submit.mockResolvedValueOnce({ ok: false, reason: "error", message, code: "walltime_over_limit" });
    card();
    await openDialog();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain(message));
  });
});

describe("DraftSubmitCard: submitting", () => {
  it("saves first, confirms with what is saved, and submits only on Confirm", async () => {
    card();
    fireEvent.click(submitButton());
    await screen.findByRole("alertdialog");

    expect(calls).toEqual(["flush"]);
    expect(submit).not.toHaveBeenCalled();
    // The summary is built from the job the flush returned.
    const text = dialog().textContent ?? "";
    expect(text).toContain("Saved snapshot title");
    expect(text).toContain("2001-03-01 to 2001-06-30");
    expect(text).toContain("discharge, runoff");
    expect(text).toContain("8");
    expect(text).toContain("2 h");
    expect(onSubmittingChange).not.toHaveBeenCalled();

    fireEvent.click(confirmButton());
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith(SUBMITTED));
    // Auto-save is stopped before the request, and the page told to lock.
    expect(calls).toEqual(["flush", "suspend", "submitting:true", "submit"]);
    expect(submit).toHaveBeenCalledWith("job-1");
    expect(onSubmitFailed).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("Submitted to Anvil");
  });

  it("says where a field comes from the snapshot's recommendation", async () => {
    flush.mockResolvedValue({
      ok: true,
      job: { ...SAVED, slurm_config: { cores: null, walltime: null } },
      withheld: [],
    });
    card();
    await openDialog();
    expect(dialog().textContent).toContain("model snapshot's recommendation");
    expect(dialog().textContent).toContain("22 min 30 s");
  });

  it("does nothing more on Cancel: no submit, nothing stopped, Submit available again", async () => {
    card();
    await openDialog();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(submit).not.toHaveBeenCalled();
    expect(suspend).not.toHaveBeenCalled();
    expect(onSubmittingChange).not.toHaveBeenCalled();
    expect(submitButton().disabled).toBe(false);
  });

  it("stops when the save failed: no dialog, no submit, and says why", async () => {
    flush.mockResolvedValue({ ok: false });
    card();
    fireEvent.click(submitButton());
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toContain("latest changes could not be saved");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(submit).not.toHaveBeenCalled();
    expect(submitButton().disabled).toBe(false);
  });

  it("stops when the save threw", async () => {
    flush.mockRejectedValue(new Error("boom"));
    card();
    fireEvent.click(submitButton());
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(submit).not.toHaveBeenCalled();
  });

  it("stops when a value was left out of the save, and names it", async () => {
    flush.mockResolvedValue({ ok: true, job: SAVED, withheld: ["start", "walltime"] });
    card();
    fireEvent.click(submitButton());
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toContain("Start date, Walltime");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(submit).not.toHaveBeenCalled();
  });

  it("ignores a second click while it is saving", async () => {
    let release: (r: FlushResult) => void = () => {};
    flush.mockReturnValue(new Promise((resolve) => (release = resolve)));
    card();
    fireEvent.click(submitButton());
    expect(screen.getByRole("button", { name: "Saving…" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Saving…" }));
    expect(flush).toHaveBeenCalledTimes(1);
    release({ ok: true, job: SAVED, withheld: [] });
    await screen.findByRole("alertdialog");
  });
});

describe("DraftSubmitCard: a submit that does not go through", () => {
  async function confirmWith(result: ActionResult<Job> | Error) {
    if (result instanceof Error) submit.mockRejectedValueOnce(result);
    else submit.mockResolvedValueOnce(result);
    card();
    await openDialog();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(onSubmitFailed).toHaveBeenCalled());
  }

  it("words a refusal, closes the dialog, unlocks the page and tells the wizard to load the draft again", async () => {
    await confirmWith({ ok: false, reason: "error", message: "raw", code: "active_job_limit" });
    expect(screen.getByRole("alert").textContent).toContain("You already have the most active simulations you can have");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(calls).toEqual(["flush", "suspend", "submitting:true", "submitting:false"]);
    expect(onSubmitted).not.toHaveBeenCalled();
  });

  it("shows the session banner for an expired session", async () => {
    await confirmWith({ ok: false, reason: "session_expired" });
    expect(screen.getByText("Your session has expired.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says a simulation that is gone is gone", async () => {
    await confirmWith({ ok: false, reason: "not_found" });
    expect(screen.getByRole("alert").textContent).toContain("This simulation no longer exists.");
  });

  it("says when the request itself failed and that My Simulations should be checked", async () => {
    await confirmWith(new Error("timeout of 60000ms exceeded"));
    const text = screen.getByRole("alert").textContent ?? "";
    expect(text).toContain("Could not confirm the submit: timeout of 60000ms exceeded.");
    expect(text).toContain("Check My Simulations");
  });

  it("keeps the dialog open and Cancel off while the submit is in flight", async () => {
    let answer: (r: ActionResult<Job>) => void = () => {};
    submit.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    card();
    await openDialog();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(within(dialog()).getByText("Submitting…")).toBeTruthy());
    expect((within(dialog()).getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(dialog(), { key: "Escape" });
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    answer({ ok: true, data: SUBMITTED });
    await waitFor(() => expect(onSubmitted).toHaveBeenCalled());
  });
});
