import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ActionResult, Job, PartialAbout, SimulationUpdateRequest } from "@/lib/jobs/types";
import type { DraftContext } from "@/lib/workspace/draft-state";
import type { DraftStep } from "@/lib/workspace/draft-wizard";

const { updateSimulation, fetchJob, submitSimulation, deleteSimulation, push, replace, refresh } = vi.hoisted(() => ({
  updateSimulation: vi.fn(),
  fetchJob: vi.fn(),
  submitSimulation: vi.fn(),
  deleteSimulation: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/lib/jobs/actions", () => ({
  updateSimulation,
  fetchJob,
  submitSimulation,
  deleteSimulation,
  deriveSimulation: vi.fn(),
  duplicateSimulation: vi.fn(),
}));
vi.mock("@/lib/repository/actions", () => ({
  fetchModelInputById: vi.fn(() => new Promise(() => {})),
  fetchModelInputs: vi.fn(() => new Promise(() => {})),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
// The address bar is the router: what a test pushes is what `useSearchParams` reads.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace, refresh }),
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import { DraftWizard } from "@/components/workspace/draft-wizard";
import { clearDraftCache, writeDraftCache } from "@/lib/workspace/draft-cache";
import { fakeDataset, fakeSimulation } from "@/lib/workspace/fixtures";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const dataset = fakeDataset({ runStartAlignment: "none" });
const yearly = fakeDataset({ runStartAlignment: "year" });
const FOUND: DraftContext = { dataset, snapshotState: "found" };

const JOB = fakeSimulation("DRAFT", {
  id: "job-1",
  dataset_id: dataset.id,
  dataset_title: "Fake Snapshot",
  updated_at: "2026-10-01T12:00:00.000Z",
  parameters: {
    temporal_range_start: "2001-01-01",
    temporal_range_end: "2001-12-31",
    spatial_domain: null,
    variables: ["discharge"],
    custom_params: null,
  },
  slurm_config: { cores: 8, walltime: "02:00:00" },
});

/** A server that keeps what it is sent, as far as these tests need. */
function fakeServer(initial: Job = JOB) {
  let current = initial;
  let n = 0;
  return async (_id: string, patch: SimulationUpdateRequest): Promise<ActionResult<Job>> => {
    n += 1;
    const about = Object.fromEntries(
      Object.entries({ ...(current.about ?? {}), ...(patch.about ?? {}) }).filter(([, v]) => v != null)
    ) as PartialAbout;
    current = {
      ...current,
      about: Object.keys(about).length > 0 ? about : null,
      parameters: patch.parameters ?? current.parameters,
      updated_at: new Date(Date.UTC(2026, 9, 1, 12, 0, n)).toISOString(),
    };
    return { ok: true, data: current };
  };
}

beforeEach(() => {
  clearDraftCache();
  window.history.replaceState(null, "", "/workspace/job-1?step=review");
  updateSimulation.mockReset();
  updateSimulation.mockImplementation(fakeServer());
  fetchJob.mockReset();
  fetchJob.mockResolvedValue({ ok: true, data: JOB });
  submitSimulation.mockReset();
  deleteSimulation.mockReset();
  push.mockReset();
  replace.mockReset();
  refresh.mockReset();
});
afterEach(() => {
  cleanup();
  document.body.style.pointerEvents = "";
});

function wizard(
  props: Partial<React.ComponentProps<typeof DraftWizard>> & { step?: DraftStep } = {}
) {
  const { step = "review", ...rest } = props;
  window.history.replaceState(null, "", `/workspace/job-1?step=${step}`);
  const element = (p: Partial<React.ComponentProps<typeof DraftWizard>>) => (
    <DraftWizard job={JOB} ctx={FOUND} blockedReason={null} initialStep={step} {...p} />
  );
  const view = render(element(rest));
  return { ...view, again: (p: Partial<React.ComponentProps<typeof DraftWizard>>) => view.rerender(element({ ...rest, ...p })) };
}

const heading = () => screen.getByRole("heading", { level: 2 }).textContent;
const nameInput = () => screen.getByLabelText("Name") as HTMLInputElement;
const type = (value: string) => fireEvent.change(nameInput(), { target: { value } });
const stepLink = (label: string) => screen.getByRole("link", { name: new RegExp(label) });
const button = (name: string) => screen.queryByRole("button", { name });
const search = () => window.location.search;
const hold = (visibility: "visible" | "hidden") =>
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });

/** Let a click's promise chains settle. */
const settle = () => act(async () => {});
/** Real time passing, with the renders it causes inside `act`. */
const pause = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

describe("the page", () => {
  it("has the breadcrumb, the name, a Draft badge, the snapshot link and the steps", () => {
    wizard();
    expect(screen.getByRole("link", { name: "My Simulations" }).getAttribute("href")).toBe("/workspace");
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe("Untitled simulation");
    expect(screen.getByRole("navigation", { name: "Breadcrumb" }).textContent).toContain("Untitled simulation");
    expect(screen.getByText("Draft")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Based on Fake Snapshot" }).getAttribute("href")).toBe(
      `/repository/${dataset.id}`
    );
    expect(screen.getByRole("navigation", { name: "Steps" })).toBeTruthy();
    expect(screen.getByText("Saved", { exact: false })).toBeTruthy();
    expect(button("More actions")).not.toBeNull();
  });

  it("follows the name as it is typed, and falls back to the slug, then to a placeholder", () => {
    wizard({ job: { ...JOB, slug: "my-slug" } });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("my-slug");
    type("  Colorado basin  ");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Colorado basin");
    expect(screen.getByRole("navigation", { name: "Breadcrumb" }).textContent).toContain("Colorado basin");
    type("   ");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("my-slug");
  });

  it("shows a saved name from the start", () => {
    wizard({ job: { ...JOB, about: { name: "Stored name" } } });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Stored name");
    expect(nameInput().value).toBe("Stored name");
  });
});

describe("the step", () => {
  it.each([
    ["model", "Model & input"],
    ["run", "Run settings"],
    ["review", "Review & submit"],
  ] as const)("opens at %s when the server says so", (step, title) => {
    wizard({ step });
    expect(heading()).toBe(title);
    expect(stepLink(title).getAttribute("aria-current")).toBe("step");
  });

  it("saves nothing just by being opened", async () => {
    wizard({ step: "run" });
    await pause(1_000);
    expect(updateSimulation).not.toHaveBeenCalled();
  });

  it("has no Back on step 2, both on step 3 and no Next on step 4", () => {
    const { unmount } = wizard({ step: "model" });
    expect(button("Back")).toBeNull();
    expect(button("Next")).not.toBeNull();
    unmount();

    const run = wizard({ step: "run" });
    expect(button("Back")).not.toBeNull();
    expect(button("Next")).not.toBeNull();
    run.unmount();

    wizard({ step: "review" });
    expect(button("Back")).not.toBeNull();
    expect(button("Next")).toBeNull();
  });

  it("goes forward and back with pushState, without asking the server for anything", () => {
    const pushState = vi.spyOn(window.history, "pushState");
    wizard({ step: "model" });
    const entries = window.history.length;

    fireEvent.click(button("Next")!);
    expect(heading()).toBe("Run settings");
    expect(search()).toBe("?step=run");
    expect(window.history.length).toBe(entries + 1);

    fireEvent.click(button("Next")!);
    expect(heading()).toBe("Review & submit");
    expect(search()).toBe("?step=review");

    fireEvent.click(button("Back")!);
    expect(heading()).toBe("Run settings");
    expect(search()).toBe("?step=run");

    expect(pushState).toHaveBeenCalledTimes(3);
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    pushState.mockRestore();
  });

  it("changes step from the strip, and pushes nothing when the URL would not change", () => {
    const pushState = vi.spyOn(window.history, "pushState");
    wizard({ step: "run" });

    fireEvent.click(stepLink("Run settings"));
    expect(pushState).not.toHaveBeenCalled();

    fireEvent.click(stepLink("Model & input"));
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(heading()).toBe("Model & input");
    expect(search()).toBe("?step=model");
    pushState.mockRestore();
  });

  it("follows the browser's back and forward", async () => {
    wizard({ step: "model" });
    fireEvent.click(button("Next")!);
    expect(heading()).toBe("Run settings");

    // Back: the address bar goes first, then the event.
    act(() => {
      window.history.replaceState(null, "", "/workspace/job-1?step=model");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(heading()).toBe("Model & input");

    act(() => {
      window.history.replaceState(null, "", "/workspace/job-1?step=run");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(heading()).toBe("Run settings");
    // Nothing was pushed or fetched for it.
    expect(push).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("opens Review for a step it does not know", () => {
    window.history.replaceState(null, "", "/workspace/job-1?step=bogus");
    render(<DraftWizard job={JOB} ctx={FOUND} blockedReason={null} initialStep="review" />);
    expect(heading()).toBe("Review & submit");
  });

  it("moves focus to the step's heading, and does not on the first render", async () => {
    wizard({ step: "model" });
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(button("Next")!);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { level: 2 })));
    expect(document.activeElement?.id).toBe("draft-step-run-heading");
  });

  it("marks the step that has a problem, and nothing is blocked by it", () => {
    wizard({ step: "model", ctx: { dataset: yearly, snapshotState: "found" }, job: {
      ...JOB,
      parameters: { ...JOB.parameters, temporal_range_start: "2001-03-15" },
    } });
    expect(stepLink("Run settings").textContent).toContain("(needs attention)");
    expect(stepLink("Model & input").textContent).not.toContain("(needs attention)");
    fireEvent.click(button("Next")!);
    expect(heading()).toBe("Run settings");
    fireEvent.click(button("Next")!);
    expect(heading()).toBe("Review & submit");
    expect(screen.getByText("Needs attention")).toBeTruthy();
  });
});

describe("saving", () => {
  it("shows Saving… and then Saved for an edit, in one request", async () => {
    wizard();
    type("Colorado");
    expect(screen.getByText("Saving…")).toBeTruthy();
    await waitFor(() => expect(updateSimulation).toHaveBeenCalledTimes(1), { timeout: 2_000 });
    expect(updateSimulation).toHaveBeenCalledWith("job-1", { about: { name: "Colorado", description: null } });
    await waitFor(() => expect(screen.queryByText("Saving…")).toBeNull());
    expect(screen.getByText("Saved", { exact: false })).toBeTruthy();
  });

  it("saves what is waiting as soon as the step changes", async () => {
    wizard({ step: "review" });
    type("Colorado");
    expect(updateSimulation).not.toHaveBeenCalled();
    fireEvent.click(stepLink("Run settings"));
    await waitFor(() => expect(updateSimulation).toHaveBeenCalledTimes(1));
    expect(updateSimulation.mock.calls[0][1]).toEqual({ about: { name: "Colorado", description: null } });
  });

  it("saves it when the browser's back changes the step, too", async () => {
    wizard({ step: "review" });
    type("Colorado");
    act(() => {
      window.history.replaceState(null, "", "/workspace/job-1?step=run");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await waitFor(() => expect(updateSimulation).toHaveBeenCalledTimes(1));
  });

  it("saves when focus leaves the step for something outside it", async () => {
    wizard({ step: "review" });
    const input = nameInput();
    input.focus();
    type("Colorado");
    fireEvent.blur(input, { relatedTarget: document.body });
    await waitFor(() => expect(updateSimulation).toHaveBeenCalledTimes(1));
  });

  it("does not save when focus only moves within the step", async () => {
    wizard({ step: "review" });
    const input = nameInput();
    type("Colorado");
    fireEvent.blur(input, { relatedTarget: screen.getByLabelText("Description") });
    await settle();
    expect(updateSimulation).not.toHaveBeenCalled();
  });
});

describe("when the draft cannot be saved", () => {
  it("says the session expired, and keeps what was typed", async () => {
    updateSimulation.mockResolvedValue({ ok: false, reason: "session_expired" });
    wizard();
    type("Colorado");
    fireEvent.click(stepLink("Run settings"));
    expect(await screen.findByText("Your session has expired.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign in" })).toBeTruthy();
    fireEvent.click(stepLink("Review & submit"));
    expect(nameInput().value).toBe("Colorado");
  });

  it("says it was submitted or changed elsewhere, and Reload asks the server for the page again", async () => {
    updateSimulation.mockResolvedValue({ ok: false, reason: "error", message: "Only drafts can be edited", status: 409 });
    wizard();
    type("Colorado");
    fireEvent.click(stepLink("Run settings"));
    const banner = await screen.findByText("This simulation was submitted or changed elsewhere");
    expect(banner.closest('[role="alert"]')).not.toBeNull();
    expect(refresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("says it was deleted, with a way back to the list", async () => {
    updateSimulation.mockResolvedValue({ ok: false, reason: "not_found" });
    wizard();
    type("Colorado");
    fireEvent.click(stepLink("Run settings"));
    expect(await screen.findByText("This draft was deleted")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to My Simulations" }).getAttribute("href")).toBe("/workspace");
    expect(screen.getByText("Not saved")).toBeTruthy();
  });

  it("shows no banner while all is well", () => {
    wizard();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Your session has expired.")).toBeNull();
  });
});

async function openDeleteDialog() {
  const trigger = screen.getByRole("button", { name: "More actions" });
  fireEvent.keyDown(trigger, { key: "Enter" });
  fireEvent.click(await screen.findByRole("menuitem", { name: "Delete draft" }));
  await screen.findByText("Delete this draft?");
}

describe("deleting the draft", () => {
  it("stops saving, deletes, and goes to the list", async () => {
    deleteSimulation.mockResolvedValue({ ok: true, data: null });
    wizard();
    type("Colorado");
    await openDeleteDialog();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete draft" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/workspace"));
    expect(push).toHaveBeenCalledTimes(1);
    expect(deleteSimulation).toHaveBeenCalledWith("job-1");

    // The edit that was waiting is not sent after the draft is gone.
    await pause(1_200);
    expect(updateSimulation).not.toHaveBeenCalled();
  });

  it("saves again when the dialog is cancelled", async () => {
    wizard();
    type("Colorado");
    await openDeleteDialog();
    // Nothing is saved behind an open Delete dialog.
    await pause(1_200);
    expect(updateSimulation).not.toHaveBeenCalled();
    expect(screen.getByText("Auto-save is off")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    await waitFor(() => expect(updateSimulation).toHaveBeenCalledTimes(1), { timeout: 2_000 });
    expect(push).not.toHaveBeenCalled();
    expect(deleteSimulation).not.toHaveBeenCalled();
  });

  it("saves again, and says why, when the delete is refused", async () => {
    deleteSimulation.mockResolvedValue({ ok: false, reason: "error", message: "Anvil can't be reached." });
    wizard();
    type("Colorado");
    await openDeleteDialog();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete draft" }));
    expect(await screen.findByText("Anvil can't be reached.")).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
    await waitFor(() => expect(updateSimulation).toHaveBeenCalledTimes(1), { timeout: 2_000 });
  });
});

describe("coming back to the tab", () => {
  const later = { ...JOB, about: { name: "Changed elsewhere" }, updated_at: "2026-10-01T13:00:00.000Z" };

  afterEach(() => hold("visible"));

  it("loads the server's copy when it moved on and nothing is unsaved", async () => {
    fetchJob.mockResolvedValue({ ok: true, data: later });
    wizard();
    expect(nameInput().value).toBe("");
    hold("visible");
    fireEvent(document, new Event("visibilitychange"));
    await waitFor(() => expect(nameInput().value).toBe("Changed elsewhere"));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Changed elsewhere");
    expect(fetchJob).toHaveBeenCalledWith("job-1");
    // It is the new baseline: nothing to save.
    await pause(1_000);
    expect(updateSimulation).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("stays on the step it was on", async () => {
    fetchJob.mockResolvedValue({ ok: true, data: later });
    wizard({ step: "run" });
    fireEvent.click(button("Next")!);
    hold("visible");
    fireEvent(document, new Event("visibilitychange"));
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Changed elsewhere"));
    expect(heading()).toBe("Review & submit");
  });

  it("asks the server for the page again when the job is not a draft any more", async () => {
    fetchJob.mockResolvedValue({ ok: true, data: { ...JOB, status: "PENDING" } });
    wizard();
    hold("visible");
    fireEvent(document, new Event("visibilitychange"));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("changes nothing when the server's copy is the one it has", async () => {
    wizard();
    hold("visible");
    fireEvent(document, new Event("visibilitychange"));
    await waitFor(() => expect(fetchJob).toHaveBeenCalledTimes(1));
    await settle();
    expect(refresh).not.toHaveBeenCalled();
    expect(nameInput().value).toBe("");
  });

  it("does not look while something is unsaved", async () => {
    wizard();
    type("Colorado");
    hold("visible");
    fireEvent(document, new Event("visibilitychange"));
    await settle();
    expect(fetchJob).not.toHaveBeenCalled();
    expect(nameInput().value).toBe("Colorado");
  });

  it("does not replace an edit made while it was looking", async () => {
    let answer!: (r: ActionResult<Job>) => void;
    fetchJob.mockReturnValue(new Promise((r) => (answer = r)));
    wizard();
    hold("visible");
    fireEvent(document, new Event("visibilitychange"));
    type("Colorado");
    await act(async () => answer({ ok: true, data: later }));
    expect(nameInput().value).toBe("Colorado");
  });

  it("does not look when the tab goes away", async () => {
    wizard();
    hold("hidden");
    fireEvent(document, new Event("visibilitychange"));
    await settle();
    expect(fetchJob).not.toHaveBeenCalled();
  });
});

describe("where it starts from", () => {
  it("takes the copy this tab last saw saved when it is newer than the server's", () => {
    writeDraftCache({ ...JOB, about: { name: "Saved in this tab" }, updated_at: "2026-10-01T12:30:00.000Z" });
    wizard();
    expect(nameInput().value).toBe("Saved in this tab");
  });

  it("takes the server's copy when that is the newer one", () => {
    writeDraftCache({ ...JOB, about: { name: "Old" }, updated_at: "2026-10-01T11:00:00.000Z" });
    wizard({ job: { ...JOB, about: { name: "Server's" } } });
    expect(nameInput().value).toBe("Server's");
  });

  it("starts over from a different copy the server page sends later", () => {
    const view = wizard();
    expect(nameInput().value).toBe("");
    view.again({ job: { ...JOB, about: { name: "Fresh from the server" }, updated_at: "2026-10-01T14:00:00.000Z" } });
    expect(nameInput().value).toBe("Fresh from the server");
  });
});

describe("submitting", () => {
  const SUBMITTED = { ...JOB, status: "PENDING" as const };

  async function openSubmitDialog() {
    fireEvent.click(screen.getByRole("button", { name: "Submit to Anvil" }));
    return screen.findByRole("alertdialog");
  }
  const confirm = (dialog: HTMLElement) =>
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit to Anvil" }));

  it("saves first, shows what is saved, and Cancel sends nothing", async () => {
    wizard();
    type("Colorado");
    const dialog = await openSubmitDialog();
    // The flush ran before the dialog opened.
    expect(updateSimulation).toHaveBeenCalledTimes(1);
    expect(updateSimulation.mock.calls[0][1]).toEqual({ about: { name: "Colorado", description: null } });
    expect(dialog.textContent).toContain("Fake Snapshot");
    expect(dialog.textContent).toContain("2001-01-01 to 2001-12-31");

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(submitSimulation).not.toHaveBeenCalled();
    // Cancelling leaves auto-save on.
    type("Colorado 2");
    await waitFor(() => expect(updateSimulation).toHaveBeenCalledTimes(2), { timeout: 2_000 });
  });

  it("opens the run's page when it goes through", async () => {
    submitSimulation.mockResolvedValue({ ok: true, data: SUBMITTED });
    wizard();
    confirm(await openSubmitDialog());
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/workspace/job-1"));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(submitSimulation).toHaveBeenCalledWith("job-1");
  });

  it("switches the inputs off while it is submitting", async () => {
    let answer!: (r: ActionResult<Job>) => void;
    submitSimulation.mockReturnValue(new Promise((r) => (answer = r)));
    wizard();
    confirm(await openSubmitDialog());
    await waitFor(() => expect((nameInput().closest("fieldset") as HTMLFieldSetElement).disabled).toBe(true));
    // Radix hides the page behind its dialog from the accessibility tree.
    expect((screen.getByRole("button", { name: "Back", hidden: true }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => answer({ ok: true, data: SUBMITTED }));
  });

  it("saves again after a submit that failed, without remounting, and shows why", async () => {
    submitSimulation.mockResolvedValue({ ok: false, reason: "error", message: "Anvil said no", code: "sbatch_rejected" });
    fetchJob.mockResolvedValue({
      ok: true,
      data: { ...JOB, last_submit_error: { code: "sbatch_rejected", message: "Anvil said no", at: "2026-10-01T12:05:00Z" } },
    });
    wizard();
    const input = nameInput();
    confirm(await openSubmitDialog());
    await waitFor(() => expect(screen.getAllByRole("alert").some((a) => a.textContent?.includes("Anvil said no"))).toBe(true));
    await waitFor(() => expect(fetchJob).toHaveBeenCalledWith("job-1"));
    // The same inputs: nothing was remounted, and they work again.
    expect(nameInput()).toBe(input);
    await waitFor(() => expect((nameInput().closest("fieldset") as HTMLFieldSetElement).disabled).toBe(false));
    expect(updateSimulation).not.toHaveBeenCalled();

    type("After the failure");
    await waitFor(() => expect(updateSimulation).toHaveBeenCalledTimes(1), { timeout: 2_000 });
    expect(updateSimulation.mock.calls[0][1]).toEqual({ about: { name: "After the failure", description: null } });
    expect(replace).not.toHaveBeenCalled();
  });

  it("does not save behind a submit that is out", async () => {
    let answer!: (r: ActionResult<Job>) => void;
    submitSimulation.mockReturnValue(new Promise((r) => (answer = r)));
    wizard();
    confirm(await openSubmitDialog());
    await waitFor(() => expect(submitSimulation).toHaveBeenCalled());
    expect(screen.getByText("Auto-save is off")).toBeTruthy();
    await pause(1_000);
    expect(updateSimulation).not.toHaveBeenCalled();
    await act(async () => answer({ ok: true, data: SUBMITTED }));
  });

  it("asks the server for the page again when the answer did not come but the job moved on", async () => {
    submitSimulation.mockRejectedValue(new Error("timed out"));
    fetchJob.mockResolvedValue({ ok: true, data: { ...JOB, status: "PENDING" } });
    wizard();
    confirm(await openSubmitDialog());
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(replace).not.toHaveBeenCalled();
  });

  it("cannot be started while the draft needs attention", () => {
    wizard({ blockedReason: "Your account has not been approved to run simulations." });
    expect((screen.getByRole("button", { name: "Submit to Anvil" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Your account has not been approved to run simulations.")).toBeTruthy();
  });
});
