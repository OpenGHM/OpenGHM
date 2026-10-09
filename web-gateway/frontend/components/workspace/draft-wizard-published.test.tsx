import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ActionResult, Job, PublishedAnswer } from "@/lib/jobs/types";
import type { DraftContext } from "@/lib/workspace/draft-state";

const { deriveDraft, updateDraft, fetchJob, submitDraft, publishedAnswer, push, replace, refresh, toast } =
  vi.hoisted(() => ({
    deriveDraft: vi.fn(),
    updateDraft: vi.fn(),
    fetchJob: vi.fn(),
    submitDraft: vi.fn(),
    publishedAnswer: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  }));
// The site header reads the session, which these tests have no provider for.
vi.mock("@/components/landing/header", () => ({ Header: () => null }));
vi.mock("@/lib/jobs/actions", () => ({
  deriveDraft,
  updateDraft,
  fetchJob,
  submitDraft,
  publishedAnswer,
  deleteDraft: vi.fn(),
  duplicateDraft: vi.fn(),
}));
vi.mock("@/lib/repository/actions", () => ({
  fetchModelInputById: vi.fn(() => new Promise(() => {})),
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
/** A stored draft. */
const STORED = fakeDraft("DRAFT", {
  id: "job-1",
  dataset_id: dataset.id,
  dataset_title: "Fake Snapshot",
  updated_at: "2026-10-01T12:00:00.000Z",
  parameters: PARAMETERS,
  slurm_config: { cores: 8, walltime: "02:00:00" },
});
/** What the server would create for a new snapshot draft: no id. */
const PREVIEW: Job = { ...STORED, id: "" };
const CREATED: Job = { ...STORED, id: "new-1", updated_at: "2026-10-01T12:00:01.000Z" };

const ANSWERED: PublishedAnswer = {
  answered: true,
  reasons: [],
  period: { start: "2001-01-01", end: "2001-12-31" },
  run_id: "WBM_test",
  files: [
    { group: "daily", variable: null, year: 2001, key: "d", url: "https://s3.example.org/d.nc", size: 696_923_827 },
    { group: "monthly", variable: "discharge", year: 2001, key: "m", url: "https://s3.example.org/m.nc", size: 1_572_864 },
    { group: "yearly", variable: "discharge", year: 2001, key: "y", url: "https://s3.example.org/y.nc", size: 2048 },
  ],
};
const NOT_ANSWERED: PublishedAnswer = {
  answered: false,
  reasons: [{ code: "spatial_domain", message: "It names a spatial domain." }],
  period: null,
  run_id: null,
  files: [],
};

const stored = (props: Partial<React.ComponentProps<typeof DraftWizard>> = {}) => {
  window.history.replaceState(null, "", "/workspace/job-1?step=review");
  return render(<DraftWizard job={STORED} ctx={FOUND} blockedReason={null} initialStep="review" {...props} />);
};
const fresh = (step: "run" | "review" = "review") => {
  window.history.replaceState(null, "", `/workspace/new/${dataset.id}?step=${step}`);
  return render(
    <DraftWizard
      job={PREVIEW}
      mode={{ kind: "new", datasetId: dataset.id }}
      ctx={FOUND}
      blockedReason={null}
      initialStep={step}
    />
  );
};

beforeEach(() => {
  clearDraftCache();
  for (const m of [deriveDraft, updateDraft, fetchJob, submitDraft, publishedAnswer, push, replace, refresh]) {
    m.mockReset();
  }
  for (const m of Object.values(toast)) m.mockReset();
  publishedAnswer.mockResolvedValue({ ok: true, data: ANSWERED });
  deriveDraft.mockResolvedValue({ ok: true, data: CREATED });
  updateDraft.mockImplementation(async (): Promise<ActionResult<Job>> => ({ ok: true, data: CREATED }));
  fetchJob.mockResolvedValue({ ok: true, data: STORED });
});
afterEach(() => {
  cleanup();
  document.body.style.pointerEvents = "";
});

const submitButton = () => screen.queryByRole("button", { name: "Submit to Anvil" });
const runAnyway = () => screen.getByRole("button", { name: "Run anyway" });
const resultsCard = () => screen.queryByRole("heading", { name: "This simulation has already been run" });

describe("Review, for a stored draft", () => {
  it("asks about the parameters on screen, once, and shows the results card instead of the submit card", async () => {
    stored();
    // Looking up: a skeleton, and nothing to submit yet.
    expect(screen.getByText(/Checking whether this is already published/).parentElement?.getAttribute("aria-busy")).toBe("true");
    expect(submitButton()).toBeNull();
    expect(await screen.findByRole("heading", { name: "This simulation has already been run" })).toBeTruthy();
    expect(publishedAnswer).toHaveBeenCalledTimes(1);
    expect(publishedAnswer).toHaveBeenCalledWith(dataset.id, PARAMETERS, null);
    expect(submitButton()).toBeNull();
    expect(screen.getByRole("link", { name: "Download daily 2001" }).getAttribute("href")).toBe("https://s3.example.org/d.nc");
    expect(screen.getByText("WBM_test")).toBeTruthy();
  });

  it("keeps Save draft in the header, off until there is something to save", async () => {
    stored();
    await screen.findByRole("heading", { name: "This simulation has already been run" });
    const save = screen.getByRole("button", { name: "Save draft" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it("shows the submit card as today when the draft is not answered, with no extra line", async () => {
    publishedAnswer.mockResolvedValue({ ok: true, data: NOT_ANSWERED });
    stored();
    expect(await screen.findByRole("button", { name: "Submit to Anvil" })).toBeTruthy();
    expect(resultsCard()).toBeNull();
    expect(screen.queryByRole("button", { name: "Run anyway" })).toBeNull();
    expect(screen.queryByText(/couldn't check/)).toBeNull();
    expect(screen.queryByText(/spatial domain/)).toBeNull();
  });

  it("shows the submit card and a small note when the check fails, and the submit still works", async () => {
    publishedAnswer.mockResolvedValue({
      ok: false,
      reason: "error",
      message: "m",
      status: 502,
      code: "published_listing_unavailable",
    });
    submitDraft.mockResolvedValue({ ok: true, data: { ...STORED, status: "PENDING" } });
    stored();
    expect(await screen.findByRole("button", { name: "Submit to Anvil" })).toBeTruthy();
    expect(screen.getByText(/couldn't check whether this is already published/)).toBeTruthy();
    expect(resultsCard()).toBeNull();

    fireEvent.click(submitButton()!);
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit to Anvil" }));
    await waitFor(() => expect(submitDraft).toHaveBeenCalledWith("job-1"));
  });

  it("treats a network failure like a failed check", async () => {
    publishedAnswer.mockRejectedValue(new Error("fetch failed"));
    stored();
    expect(await screen.findByRole("button", { name: "Submit to Anvil" })).toBeTruthy();
    expect(screen.getByText(/couldn't check/)).toBeTruthy();
  });

  it("says the years come from the published simulation when the draft starts later than it", async () => {
    publishedAnswer.mockResolvedValue({ ok: true, data: { ...ANSWERED, period: { start: "2000-01-01", end: "2001-12-31" } } });
    stored();
    await screen.findByRole("heading", { name: "This simulation has already been run" });
    expect(screen.getByText(/whose spinup began earlier/)).toBeTruthy();
  });

  it("does not say it when the draft starts with the published simulation", async () => {
    stored();
    await screen.findByRole("heading", { name: "This simulation has already been run" });
    expect(screen.queryByText(/whose spinup began earlier/)).toBeNull();
  });

  it("Run anyway saves, confirms with copy about rerunning and allocation, and submits with rerun: true", async () => {
    submitDraft.mockResolvedValue({ ok: true, data: { ...STORED, status: "PENDING" } });
    stored();
    await screen.findByRole("heading", { name: "This simulation has already been run" });
    fireEvent.click(runAnyway());
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByRole("heading", { name: "Run it again anyway?" })).toBeTruthy();
    expect(dialog.textContent).toContain("already published");
    expect(dialog.textContent).toContain("compute time");
    expect(submitDraft).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Run anyway" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/workspace/job-1"));
    expect(submitDraft).toHaveBeenCalledTimes(1);
    expect(submitDraft).toHaveBeenCalledWith("job-1", { rerun: true });
  });

  it("Cancel in that dialog runs nothing", async () => {
    stored();
    await screen.findByRole("heading", { name: "This simulation has already been run" });
    fireEvent.click(runAnyway());
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(submitDraft).not.toHaveBeenCalled();
  });

  it("shows the results card when a submit is refused as answered (the page was out of step)", async () => {
    publishedAnswer.mockResolvedValueOnce({ ok: true, data: NOT_ANSWERED });
    publishedAnswer.mockResolvedValueOnce({ ok: true, data: ANSWERED });
    submitDraft.mockResolvedValue({
      ok: false,
      reason: "error",
      status: 409,
      code: "answered_by_published",
      message: "The published results answer this draft.",
    });
    stored();
    fireEvent.click(await screen.findByRole("button", { name: "Submit to Anvil" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit to Anvil" }));
    expect(await screen.findByRole("heading", { name: "This simulation has already been run" })).toBeTruthy();
    expect(publishedAnswer).toHaveBeenCalledTimes(2);
    expect(submitDraft).toHaveBeenCalledWith("job-1");
    expect(screen.getByRole("button", { name: "Run anyway" })).toBeTruthy();
    expect(submitButton()).toBeNull();
  });

  it("asks again after the period is edited on Run settings, and not when nothing changed", async () => {
    stored();
    await screen.findByRole("heading", { name: "This simulation has already been run" });
    // Out to Run settings and back with nothing changed: no new question.
    fireEvent.click(screen.getByRole("button", { name: "Edit run period" }));
    await screen.findByRole("heading", { level: 2, name: "Run settings" });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByRole("heading", { name: "This simulation has already been run" });
    expect(publishedAnswer).toHaveBeenCalledTimes(1);
  });
});

describe("Review, for a new snapshot draft that is not saved", () => {
  it("asks with the preview's parameters and shows the results card; nothing is saved by looking", async () => {
    fresh();
    expect(await screen.findByRole("heading", { name: "This simulation has already been run" })).toBeTruthy();
    expect(publishedAnswer).toHaveBeenCalledWith(dataset.id, PARAMETERS, null);
    expect(deriveDraft).not.toHaveBeenCalled();
    expect(updateDraft).not.toHaveBeenCalled();
    expect(screen.getByText("Not saved")).toBeTruthy();
  });

  it("keeps Save as draft working beside the results card", async () => {
    fresh();
    await screen.findByRole("heading", { name: "This simulation has already been run" });
    const save = screen.getAllByRole("button", { name: "Save as draft" })[0] as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(deriveDraft).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/workspace/new-1?step=review"));
    expect(submitDraft).not.toHaveBeenCalled();
  });

  it("Run anyway saves the draft first, then submits it with rerun: true", async () => {
    submitDraft.mockResolvedValue({ ok: true, data: { ...CREATED, status: "PENDING" } });
    fresh();
    await screen.findByRole("heading", { name: "This simulation has already been run" });
    fireEvent.click(runAnyway());
    const dialog = await screen.findByRole("alertdialog");
    // The draft was created for the confirmation, not before the click.
    expect(deriveDraft).toHaveBeenCalledTimes(1);
    expect(submitDraft).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Run anyway" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/workspace/new-1"));
    expect(submitDraft).toHaveBeenCalledWith("new-1", { rerun: true });
    expect(deriveDraft).toHaveBeenCalledTimes(1);
  });

  it("shows the submit card, with a note, when the check fails", async () => {
    publishedAnswer.mockResolvedValue({ ok: false, reason: "error", message: "m", status: 502 });
    fresh();
    expect(await screen.findByRole("button", { name: "Submit to Anvil" })).toBeTruthy();
    expect(screen.getByText(/couldn't check whether this is already published/)).toBeTruthy();
  });

  it("asks nothing while Run settings is showing, and when Review opens", async () => {
    fresh("run");
    await Promise.resolve();
    expect(publishedAnswer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("heading", { name: "This simulation has already been run" })).toBeTruthy();
    expect(publishedAnswer).toHaveBeenCalledTimes(1);
  });

  it("a submit refused as answered saves the draft and opens it on Review, where the answer shows", async () => {
    publishedAnswer.mockResolvedValueOnce({ ok: true, data: NOT_ANSWERED });
    submitDraft.mockResolvedValue({
      ok: false,
      reason: "error",
      status: 409,
      code: "answered_by_published",
      message: "The published results answer this draft.",
    });
    fresh();
    fireEvent.click(await screen.findByRole("button", { name: "Submit to Anvil" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit to Anvil" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/workspace/new-1?step=review"));
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("Your draft was saved, but it was not submitted. The model snapshot already publishes these results")
    );
  });
});
