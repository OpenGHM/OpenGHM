import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ActionResult, DraftChecks, Job } from "@/lib/jobs/types";
import type { DraftContext } from "@/lib/workspace/draft-state";

const { updateDraft, fetchJob, submitDraft, draftChecks, push, replace, refresh, toast } = vi.hoisted(() => ({
  updateDraft: vi.fn(),
  fetchJob: vi.fn(),
  submitDraft: vi.fn(),
  draftChecks: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
// The site header reads the session, which these tests have no provider for.
vi.mock("@/components/landing/header", () => ({ Header: () => null }));
vi.mock("@/lib/jobs/actions", () => ({
  updateDraft,
  fetchJob,
  submitDraft,
  draftChecks,
  publishedAnswer: vi.fn(() => new Promise(() => {})),
  deriveDraft: vi.fn(),
  deleteDraft: vi.fn(),
  duplicateDraft: vi.fn(),
}));
// The published results are not what these tests are about: none are looked up.
vi.mock("@/lib/workspace/use-published-answer", () => ({
  usePublishedAnswer: () => ({ state: { status: "none" }, refresh: () => {} }),
}));
vi.mock("@/lib/repository/actions", () => ({
  fetchModelInputById: vi.fn(() => new Promise(() => {})),
  fetchModelParameters: vi.fn(() => new Promise(() => {})),
}));
vi.mock("sonner", () => ({ toast }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace, refresh }),
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import { DraftWizard } from "@/components/workspace/draft-wizard";
import { clearDraftCache } from "@/lib/workspace/draft-cache";
import { fakeDataset, fakeDraft } from "@/lib/workspace/fixtures";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const dataset = fakeDataset({ runStartAlignment: "none" });
const FOUND: DraftContext = { dataset, snapshotState: "found" };

const PARAMETERS = {
  temporal_range_start: "2001-01-01",
  temporal_range_end: "2001-12-31",
  spatial_domain: null,
  variables: ["discharge"],
  custom_params: null,
};
const STORED = fakeDraft("DRAFT", {
  id: "job-1",
  dataset_id: dataset.id,
  dataset_title: "Fake Snapshot",
  updated_at: "2026-10-01T12:00:00.000Z",
  parameters: PARAMETERS,
  slurm_config: { cores: 8 },
});
const PREVIEW: Job = { ...STORED, id: "" };

const COVERAGE = {
  rule: "dataset_file_coverage",
  level: "error" as const,
  message: "The dataset merra2_prectotcorr_d read by MT_Precip.Primary has no file for 2002-01-01: /wbm/data/climate/precip/2002/x.nc is not in the model input.",
  paths: ["MT_Precip.Primary", "MT_Code_Name.Run_End"],
};
const MSK = {
  rule: "msk_outputs_runoff_mask_pairing",
  level: "error" as const,
  message: "The output dischMsk needs the Runoff_mask block.",
  paths: ["Output_vars", "Runoff_mask"],
};
const IRR = {
  rule: "irr_outputs_without_irrigation",
  level: "warn" as const,
  message: "Irrigation is off, so WBM drops these irrigation re-use outputs without a word: runoff_irr.",
  paths: ["Output_vars", "Irrigation"],
};
const answer = (over: Partial<DraftChecks> = {}) =>
  draftChecks.mockResolvedValue({ ok: true, data: { errors: [], warnings: [], files_checked: true, ...over } });

const stored = (step: "run" | "review" = "review") => {
  window.history.replaceState(null, "", `/workspace/job-1?step=${step}`);
  return render(<DraftWizard job={STORED} ctx={FOUND} blockedReason={null} initialStep={step} />);
};
const fresh = () => {
  window.history.replaceState(null, "", `/workspace/new/${dataset.id}?step=review`);
  return render(
    <DraftWizard job={PREVIEW} mode={{ kind: "new", datasetId: dataset.id }} ctx={FOUND} blockedReason={null} initialStep="review" />
  );
};

beforeEach(() => {
  clearDraftCache();
  for (const m of [updateDraft, fetchJob, submitDraft, draftChecks, push, replace, refresh]) m.mockReset();
  for (const m of Object.values(toast)) m.mockReset();
  answer();
  updateDraft.mockImplementation(async (): Promise<ActionResult<Job>> => ({ ok: true, data: STORED }));
  fetchJob.mockResolvedValue({ ok: true, data: STORED });
});
afterEach(() => {
  cleanup();
  document.body.style.pointerEvents = "";
});

const submit = () => screen.getByRole("button", { name: "Submit to Anvil" }) as HTMLButtonElement;
const row = (label: string) => screen.getByText(label, { selector: "dt" }).parentElement as HTMLElement;

describe("Review, with the checks of the rules", () => {
  it("asks about the parameters on screen, with the snapshot, once", async () => {
    stored();
    await waitFor(() => expect(draftChecks).toHaveBeenCalledTimes(1));
    expect(draftChecks).toHaveBeenCalledWith(dataset.id, PARAMETERS);
  });

  it("asks a new draft too, which has no id and nothing saved", async () => {
    fresh();
    await waitFor(() => expect(draftChecks).toHaveBeenCalledTimes(1));
    expect(draftChecks).toHaveBeenCalledWith(dataset.id, PARAMETERS);
  });

  it("says that it is checking, and an error turns the submit off with the reason and a way to fix it", async () => {
    answer({ errors: [COVERAGE] });
    stored();
    expect(screen.getByText(/Checking that the datasets cover the run/)).toBeTruthy();
    // said at the run period and listed with what stands in the way of the submit
    await waitFor(() => expect(within(row("Run period")).getByText(COVERAGE.message)).toBeTruthy());
    expect(submit().disabled).toBe(true);
    expect(screen.getByText("Fix this to submit:")).toBeTruthy();
    expect(screen.getAllByText(COVERAGE.message)).toHaveLength(2);
    expect(screen.queryByText(/Checking that the datasets cover the run/)).toBeNull();
  });

  it("turns the submit off for an error about no date as well, and says it only in the list", async () => {
    answer({ errors: [MSK] });
    stored();
    await waitFor(() => expect(submit().disabled).toBe(true));
    expect(screen.getAllByText(MSK.message)).toHaveLength(1);
    // its Fix goes to the output variables
    fireEvent.click(screen.getByRole("button", { name: "Fix output variables" }));
    await waitFor(() => expect(screen.getByRole("heading", { level: 2, name: "Run settings" })).toBeTruthy());
  });

  it("lists every error, and an error no field mends has no Fix", async () => {
    answer({ errors: [COVERAGE, { ...MSK, paths: ["Network"], message: "The run has no river network file." }] });
    stored();
    await waitFor(() => expect(screen.getByText("Fix these 2 things to submit:")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Fix end date" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Fix / })).toHaveLength(1);
  });

  it("shows a warning and lets the submit through", async () => {
    answer({ warnings: [IRR] });
    submitDraft.mockResolvedValue({ ok: true, data: { ...STORED, status: "PENDING" } });
    stored();
    const card = (await screen.findByRole("heading", { name: "Heads up" })).closest("section") as HTMLElement;
    expect(within(card).getByText(IRR.message)).toBeTruthy();
    expect(submit().disabled).toBe(false);
    fireEvent.click(submit());
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit to Anvil" }));
    await waitFor(() => expect(submitDraft).toHaveBeenCalledWith("job-1"));
  });

  it("says nothing and submits as before when no rule fails", async () => {
    stored();
    await waitFor(() => expect(draftChecks).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText(/Checking that the datasets cover the run/)).toBeNull());
    expect(screen.queryByRole("heading", { name: "Heads up" })).toBeNull();
    expect(submit().disabled).toBe(false);
  });

  it("says a check that failed in one line and keeps the submit on", async () => {
    draftChecks.mockResolvedValue({ ok: false, reason: "error", message: "m", status: 503, code: "init_unavailable" });
    stored();
    expect(await screen.findByText(/We couldn't check the run against its datasets/)).toBeTruthy();
    expect(submit().disabled).toBe(false);
  });
});

describe("Run settings, with the checks of the rules", () => {
  it("shows the date error beside the date it concerns once Review has asked, and Fix goes there", async () => {
    answer({ errors: [COVERAGE] });
    stored();
    await waitFor(() => expect(submit().disabled).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Fix end date" }));
    await waitFor(() => expect(screen.getByRole("heading", { level: 2, name: "Run settings" })).toBeTruthy());
    expect(screen.getByLabelText("End").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText(COVERAGE.message).id).toMatch(/-end-error$/);
    expect(screen.getByLabelText("Start").getAttribute("aria-invalid")).toBeNull();
  });

  it("drops the error once the date is edited, and asks again when Review shows with what was typed", async () => {
    answer({ errors: [COVERAGE] });
    stored();
    await waitFor(() => expect(submit().disabled).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Fix end date" }));
    await waitFor(() => expect(screen.getByLabelText("End")).toBeTruthy());
    answer();
    fireEvent.change(screen.getByLabelText("End"), { target: { value: "2001-06-30" } });
    expect(screen.queryByText(COVERAGE.message)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next: Review" }));
    // nothing was saved: the question is the parameters on screen
    await waitFor(() => expect(draftChecks).toHaveBeenCalledTimes(2));
    expect(draftChecks.mock.calls[1][1]).toEqual({ ...PARAMETERS, temporal_range_end: "2001-06-30" });
    expect(updateDraft).not.toHaveBeenCalled();
    await waitFor(() => expect(submit().disabled).toBe(false));
  });
});
