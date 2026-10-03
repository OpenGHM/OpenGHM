import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ActionResult, Job } from "@/lib/jobs/types";

vi.mock("next/navigation", () => ({ usePathname: () => "/workspace/job-1" }));

import { DraftSubmitCard } from "@/components/workspace/draft-submit-card";
import type { SubmitProblem } from "@/lib/workspace/draft-state";
import type { FlushResult } from "@/lib/workspace/use-draft-saver";
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
const onFix = vi.fn();
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
      onFix={onFix}
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
  it("says Submit saves the changes first", () => {
    card();
    expect(screen.getByText(/Submitting saves your changes first/)).toBeTruthy();
    expect(submitButton().disabled).toBe(false);
  });

  it("is off while something is in the way, lists it, and takes you to the field", () => {
    const problems: SubmitProblem[] = [
      { step: "review", message: "You are not permitted to run simulations yet." },
      { field: "start", step: "run", message: "Choose a start date that exists." },
    ];
    card({ problems });
    expect(submitButton().disabled).toBe(true);
    expect(screen.getByText("Fix these 2 things to submit:")).toBeTruthy();
    expect(submitButton().getAttribute("aria-describedby")).toBeTruthy();
    fireEvent.click(submitButton());
    expect(flush).not.toHaveBeenCalled();

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    // A problem of the whole draft has no field to go to.
    expect(items[0].textContent).toContain("You are not permitted to run simulations yet.");
    expect(within(items[0]).queryByRole("button")).toBeNull();
    expect(items[1].textContent).toContain("Start date: Choose a start date that exists.");
    fireEvent.click(within(items[1]).getByRole("button", { name: "Fix start date" }));
    expect(onFix).toHaveBeenCalledWith("run", "start");
  });

  it("lists nothing when nothing is in the way", () => {
    card();
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByText(/to submit:/)).toBeNull();
  });

  it("uses the singular for one thing", () => {
    card({ problems: [{ step: "review", message: "x" }] });
    expect(screen.getByText("Fix this to submit:")).toBeTruthy();
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

describe("DraftSubmitCard: cores below the recommended count", () => {
  const warning = /This model snapshot recommends 64 cores/;
  const withCores = (cores: number | null) => ({
    ...SAVED,
    slurm_config: { cores, walltime: "02:00:00" },
  });

  it("is in the confirmation, which still lets the person submit", async () => {
    flush.mockResolvedValue({ ok: true, job: withCores(1), withheld: [] });
    card({ recommended: { cores: 64, walltime: "15:00" } });
    expect(screen.queryByText(warning)).toBeNull(); // not before the dialog
    await openDialog();
    const note = within(dialog()).getByText(warning);
    expect(note.textContent).toContain("and 1 core only about 1.9 GB:");
    expect(note.closest("dd")?.previousElementSibling?.textContent).toBe("Cores");
    expect((confirmButton() as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(confirmButton());
    await waitFor(() => expect(submit).toHaveBeenCalledWith("job-1"));
  });

  it.each([64, null])("is not in the confirmation for cores %s", async (cores) => {
    flush.mockResolvedValue({ ok: true, job: withCores(cores), withheld: [] });
    card({ recommended: { cores: 64, walltime: "15:00" } });
    await openDialog();
    expect(within(dialog()).queryByText(warning)).toBeNull();
  });

  it("is not in the confirmation without a recommendation", async () => {
    flush.mockResolvedValue({ ok: true, job: withCores(1), withheld: [] });
    card({ recommended: null });
    await openDialog();
    expect(within(dialog()).queryByText(/snapshot recommends/)).toBeNull();
  });
});

describe("DraftSubmitCard: the stale error", () => {
  const STALE = {
    code: "sbatch_rejected",
    message: "QOSMaxWallDurationPerJobLimit",
    at: "2026-10-02T00:00:00Z",
  };
  const stale = () => screen.queryByText(/QOSMaxWallDurationPerJobLimit/);

  it("hides the last submit's error while this one is in flight", async () => {
    submit.mockReturnValueOnce(new Promise(() => {}));
    card({ lastSubmitError: STALE });
    expect(stale()).toBeTruthy();
    await openDialog();
    expect(stale()).toBeTruthy();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(within(dialog()).getByText("Submitting…")).toBeTruthy());
    expect(stale()).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows nothing but Submitted once it went through, even if the stale error is still passed in", async () => {
    card({ lastSubmitError: STALE });
    await openDialog();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(onSubmitted).toHaveBeenCalled());
    expect(stale()).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Submitted — opening the job page…");
    expect(screen.queryByRole("button", { name: "Submit to Anvil" })).toBeNull();
    expect(screen.queryByText(/Submitting saves your changes first/)).toBeNull();
  });

  it("shows a new failure's own message and not the old one", async () => {
    submit.mockResolvedValueOnce({ ok: false, reason: "error", message: "new reason", code: "sbatch_rejected" });
    card({ lastSubmitError: STALE });
    await openDialog();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(onSubmitFailed).toHaveBeenCalled());
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert").textContent).toContain("new reason");
    expect(stale()).toBeNull();
  });

  it("does not bring the old error back after a failure that has no message of its own", async () => {
    submit.mockResolvedValueOnce({ ok: false, reason: "session_expired" });
    card({ lastSubmitError: STALE });
    await openDialog();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(onSubmitFailed).toHaveBeenCalled());
    expect(stale()).toBeNull();
  });
});

describe("DraftSubmitCard: after it went through", () => {
  it("shows a spinner and the opening message, and nothing else", async () => {
    card();
    await openDialog();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("Submitted — opening the job page…");
    expect(status.querySelector("svg.animate-spin, svg[class*='animate-spin']")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("offers a plain link to the job page when the wizard says the page did not follow", async () => {
    const view = card();
    await openDialog();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(onSubmitted).toHaveBeenCalled());
    view.rerender(
      <DraftSubmitCard
        jobId="job-1"
        problems={[]}
        onFix={onFix}
        lastSubmitError={null}
        recommended={RECOMMENDED}
        flush={flush}
        suspend={suspend}
        submit={submit}
        onSubmitted={onSubmitted}
        openJobHref="/workspace/job-1"
      />
    );
    expect(screen.getByRole("status").textContent).toContain("The submit went through but this page did not update.");
    const link = screen.getByRole("link", { name: "Open the job page" });
    expect(link.getAttribute("href")).toBe("/workspace/job-1");
    expect(screen.queryByText(/opening the job page…/)).toBeNull();
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
    // Saving is stopped before the request, and the page told to lock.
    expect(calls).toEqual(["flush", "suspend", "submitting:true", "submit"]);
    expect(submit).toHaveBeenCalledWith("job-1");
    expect(onSubmitFailed).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("Submitted — opening the job page…");
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

  it("checks the server after a lost answer, and takes the success path when the job is no longer a draft", async () => {
    const checkSubmitted = vi.fn().mockResolvedValue(SUBMITTED);
    submit.mockRejectedValueOnce(new Error("timeout of 60000ms exceeded"));
    card({ checkSubmitted });
    await openDialog();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith(SUBMITTED));
    expect(checkSubmitted).toHaveBeenCalledWith("job-1");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Submitted — opening the job page…");
    // Never unlocked, never told the submit failed.
    expect(onSubmitFailed).not.toHaveBeenCalled();
    expect(calls).toEqual(["flush", "suspend", "submitting:true"]);
  });

  it("shows the message first, and keeps it when the check says the job is still a draft", async () => {
    let answer: (job: Job | null) => void = () => {};
    const checkSubmitted = vi.fn(() => new Promise<Job | null>((resolve) => (answer = resolve)));
    submit.mockRejectedValueOnce(new Error("timeout"));
    card({ checkSubmitted });
    await openDialog();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(checkSubmitted).toHaveBeenCalled());
    expect(screen.getByRole("alert").textContent).toContain("Could not confirm the submit: timeout.");
    expect(submitButton().disabled).toBe(true);
    answer(null);
    await waitFor(() => expect(onSubmitFailed).toHaveBeenCalled());
    expect(screen.getByRole("alert").textContent).toContain("Could not confirm the submit");
    expect(onSubmitted).not.toHaveBeenCalled();
    expect(submitButton().disabled).toBe(false);
  });

  it("treats a check that itself throws as a draft that is still a draft", async () => {
    const checkSubmitted = vi.fn().mockRejectedValue(new Error("down"));
    submit.mockRejectedValueOnce(new Error("timeout"));
    card({ checkSubmitted });
    await openDialog();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(onSubmitFailed).toHaveBeenCalled());
    expect(onSubmitted).not.toHaveBeenCalled();
  });

  it("does not check after a refusal: the backend answered", async () => {
    const checkSubmitted = vi.fn();
    submit.mockResolvedValueOnce({ ok: false, reason: "error", message: "no", code: "sbatch_rejected" });
    card({ checkSubmitted });
    await openDialog();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(onSubmitFailed).toHaveBeenCalled());
    expect(checkSubmitted).not.toHaveBeenCalled();
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
