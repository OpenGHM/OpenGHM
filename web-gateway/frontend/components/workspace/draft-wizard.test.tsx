import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ActionResult, Job, PartialAbout, DraftUpdateRequest } from "@/lib/jobs/types";
import type { DraftContext } from "@/lib/workspace/draft-state";
import type { DraftStep } from "@/lib/workspace/draft-wizard";

const { updateDraft, fetchJob, submitDraft, deleteDraft, push, replace, refresh, toast } = vi.hoisted(() => ({
  updateDraft: vi.fn(),
  fetchJob: vi.fn(),
  submitDraft: vi.fn(),
  deleteDraft: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/lib/jobs/actions", () => ({
  updateDraft,
  fetchJob,
  submitDraft,
  deleteDraft,
  deriveDraft: vi.fn(),
  duplicateDraft: vi.fn(),
}));
// These tests are about saving and submitting: no published results are looked
// up (draft-wizard-published.test.tsx covers the lookup).
vi.mock("@/lib/workspace/use-published-answer", () => ({
  usePublishedAnswer: () => ({ state: { status: "none" }, refresh: () => {} }),
}));
vi.mock("@/lib/repository/actions", () => ({
  fetchModelInputById: vi.fn(() => new Promise(() => {})),
}));
vi.mock("sonner", () => ({ toast }));
// The address bar is the router: what a test pushes is what `useSearchParams` reads.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace, refresh }),
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import { DraftWizard } from "@/components/workspace/draft-wizard";
import { clearDraftCache, readDraftCache, writeDraftCache } from "@/lib/workspace/draft-cache";
import { fakeDataset, fakeDraft } from "@/lib/workspace/fixtures";
import { FakeNavigation } from "@/lib/workspace/fake-navigation";

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

const JOB = fakeDraft("DRAFT", {
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
  return async (_id: string, patch: DraftUpdateRequest): Promise<ActionResult<Job>> => {
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
  updateDraft.mockReset();
  updateDraft.mockImplementation(fakeServer());
  fetchJob.mockReset();
  fetchJob.mockResolvedValue({ ok: true, data: JOB });
  submitDraft.mockReset();
  deleteDraft.mockReset();
  push.mockReset();
  replace.mockReset();
  refresh.mockReset();
  for (const m of Object.values(toast)) m.mockReset();
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

describe("the header", () => {
  it("names the draft by the list's rule, with the live typed name first", () => {
    const { again } = wizard({ step: "run" });
    const h1 = () => screen.getByRole("heading", { level: 1 }).textContent;
    expect(h1()).toBe("Untitled (job-1)");
    type("  My run ");
    expect(h1()).toBe("My run");
    type("   ");
    expect(h1()).toBe("Untitled (job-1)");
    // A slug comes before the placeholder, a run id before neither (a draft has none).
    again({ job: { ...JOB, slug: "my-slug", updated_at: "2026-10-01T13:00:00.000Z" } });
    expect(h1()).toBe("my-slug");
    type("Typed");
    expect(h1()).toBe("Typed");
  });

  it("says what it is based on by the snapshot's title, in one truncated line, with the whole title on hover", () => {
    const title = "A very long model snapshot title ".repeat(6);
    wizard({ job: { ...JOB, dataset_title: title } });
    const link = screen.getByRole("link", { name: /^Based on A very long/ });
    expect(link.textContent).toBe(`Based on ${title}`);
    expect(link.className).toContain("truncate");
    expect(link.className).toContain("block");
    expect(link.className).toContain("hover:underline");
    expect(link.className).not.toMatch(/(^|\s)underline(\s|$)/);
    expect(link.getAttribute("title")).toBe(title);
    expect(link.getAttribute("href")).toBe(`/repository/${dataset.id}`);
  });

  it("says the same when the snapshot is gone: the title the draft was made with", () => {
    wizard({
      job: { ...JOB, dataset_title: "A very long model snapshot title ".repeat(6) },
      ctx: { dataset: null, snapshotState: "gone" },
    });
    const link = screen.getByRole("link", { name: /^Based on A very long/ });
    expect(link.getAttribute("title")).toBe("A very long model snapshot title ".repeat(6));
  });

  it("is a light header, with no dark gradient and nothing white on it", () => {
    const { container } = wizard();
    const header = container.querySelector("header")!;
    expect(header.innerHTML).not.toContain("gradient");
    expect(header.innerHTML).not.toContain("text-white");
  });
});

describe("the page", () => {
  it("has the breadcrumb, the name, an Editing badge, the snapshot link and the steps", () => {
    wizard();
    expect(screen.getByRole("link", { name: "My snapshot drafts" }).getAttribute("href")).toBe("/workspace");
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe("Untitled (job-1)");
    expect(screen.getByRole("navigation", { name: "Breadcrumb" }).textContent).toContain("Untitled (job-1)");
    expect(screen.getByText("Editing")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Based on Fake Snapshot" }).getAttribute("href")).toBe(
      `/repository/${dataset.id}`
    );
    expect(screen.getByRole("navigation", { name: "Steps" })).toBeTruthy();
    expect(screen.getByText("Saved", { exact: false })).toBeTruthy();
    expect(button("Delete snapshot draft")).not.toBeNull();
  });

  it("follows the name as it is typed, and falls back to the slug, then to a placeholder", () => {
    wizard({ step: "run", job: { ...JOB, slug: "my-slug" } });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("my-slug");
    type("  Colorado basin  ");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Colorado basin");
    expect(screen.getByRole("navigation", { name: "Breadcrumb" }).textContent).toContain("Colorado basin");
    type("   ");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("my-slug");
  });

  it("keeps the Name input empty for an unnamed draft: the header's fallback is never put in it", () => {
    const { again } = wizard({ step: "run" });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Untitled (job-1)");
    expect(nameInput().value).toBe("");
    expect(nameInput().placeholder).toMatch(/^e\.g\. /);
    expect(nameInput().placeholder).not.toContain("Untitled");
    again({ job: { ...JOB, slug: "my-slug", updated_at: "2026-10-01T13:00:00.000Z" } });
    expect(nameInput().value).toBe("");
    expect(nameInput().placeholder).not.toContain("my-slug");
  });

  it("focuses the empty Name when Run settings opens on an unnamed draft, and not on a named one", () => {
    const first = wizard({ step: "run" });
    expect(document.activeElement).toBe(nameInput());
    first.unmount();
    wizard({ step: "run", job: { ...JOB, about: { name: "Stored name" } } });
    expect(document.activeElement).toBe(document.body);
  });

  it("does not focus the Name when the draft opens on Review", () => {
    wizard({ step: "review" });
    expect(document.activeElement).toBe(document.body);
  });

  it("shows a saved name from the start", () => {
    wizard({ step: "run", job: { ...JOB, about: { name: "Stored name" } } });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Stored name");
    expect(nameInput().value).toBe("Stored name");
  });
});

describe("the step", () => {
  it.each([
    ["run", "Run settings"],
    ["review", "Review & submit"],
  ] as const)("opens at %s when the server says so", (step, title) => {
    wizard({ step });
    expect(heading()).toBe(title);
    expect(stepLink(title).getAttribute("aria-current")).toBe("step");
  });

  it("has only two steps after Start from: there is no Model & input", () => {
    wizard({ step: "run" });
    expect(screen.queryByRole("link", { name: /Model & input/ })).toBeNull();
    expect(screen.getAllByRole("link", { name: /^\d/ })).toHaveLength(2);
  });

  it("opens Run settings for the retired ?step=model, and rewrites the address", () => {
    const replaceState = vi.spyOn(window.history, "replaceState");
    window.history.replaceState(null, "", "/workspace/job-1?step=model");
    // What the server page passes: parseStep("model") is "run".
    render(<DraftWizard job={JOB} ctx={FOUND} blockedReason={null} initialStep="run" />);
    expect(heading()).toBe("Run settings");
    expect(search()).toBe("?step=run");
    replaceState.mockRestore();
  });

  it("saves nothing just by being opened", async () => {
    wizard({ step: "run" });
    await pause(1_000);
    expect(updateDraft).not.toHaveBeenCalled();
  });

  it("has no Back on Run settings (the draft's start cannot change) and no Next on Review", () => {
    const run = wizard({ step: "run" });
    expect(button("Back")).toBeNull();
    expect(button("Next")).not.toBeNull();
    run.unmount();

    wizard({ step: "review" });
    expect(button("Back")).not.toBeNull();
    expect(button("Next")).toBeNull();
  });

  it("goes forward and back with pushState, without asking the server for anything", () => {
    const pushState = vi.spyOn(window.history, "pushState");
    wizard({ step: "run" });
    const entries = window.history.length;

    fireEvent.click(button("Next")!);
    expect(heading()).toBe("Review & submit");
    expect(search()).toBe("?step=review");
    expect(window.history.length).toBe(entries + 1);

    fireEvent.click(button("Back")!);
    expect(heading()).toBe("Run settings");
    expect(search()).toBe("?step=run");

    expect(pushState).toHaveBeenCalledTimes(2);
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

    fireEvent.click(stepLink("Review & submit"));
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(heading()).toBe("Review & submit");
    expect(search()).toBe("?step=review");
    pushState.mockRestore();
  });

  it("follows the browser's back and forward", async () => {
    wizard({ step: "run" });
    fireEvent.click(button("Next")!);
    expect(heading()).toBe("Review & submit");

    // Back: the address bar goes first, then the event.
    act(() => {
      window.history.replaceState(null, "", "/workspace/job-1?step=run");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(heading()).toBe("Run settings");

    act(() => {
      window.history.replaceState(null, "", "/workspace/job-1?step=review");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(heading()).toBe("Review & submit");
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
    wizard({ step: "run", job: { ...JOB, about: { name: "Named" } } });
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(button("Next")!);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { level: 2 })));
    expect(document.activeElement?.id).toBe("draft-step-review-heading");
  });

  describe("a Fix link in the submit area", () => {
    const badStart = { ...JOB, parameters: { ...JOB.parameters, temporal_range_start: "2001-03-15" } };
    const fix = (name: string) => screen.getByRole("button", { name });

    it("goes to the step and focuses the field's control", async () => {
      wizard({ ctx: { dataset: yearly, snapshotState: "found" }, job: badStart });
      fireEvent.click(fix("Fix start date"));
      expect(heading()).toBe("Run settings");
      expect(search()).toBe("?step=run");
      await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Start")));
    });

    it("focuses the first checkbox of a short list of variables, and the Revert button of a chosen model input", async () => {
      const { unmount } = wizard({ job: { ...JOB, parameters: { ...JOB.parameters, variables: [] } } });
      fireEvent.click(fix("Fix output variables"));
      await waitFor(() => expect(document.activeElement).toBe(screen.getAllByRole("checkbox")[0]));
      unmount();

      wizard({ job: { ...JOB, model_input_id: "other-input" } });
      fireEvent.click(fix("Fix model input"));
      expect(heading()).toBe("Run settings");
      await waitFor(() => expect(document.activeElement).toBe(button("Revert")));
    });

    it("falls back to the step's heading when the step has no such control", async () => {
      // No snapshot and no variables chosen: there is no list to take focus.
      wizard({
        ctx: { dataset: null, snapshotState: "unavailable" },
        job: { ...JOB, parameters: { ...JOB.parameters, variables: [] } },
      });
      fireEvent.click(fix("Fix output variables"));
      await waitFor(() => expect(document.activeElement?.id).toBe("draft-step-run-heading"));
    });

    it("focuses once: later steps go to their heading again", async () => {
      wizard({ ctx: { dataset: yearly, snapshotState: "found" }, job: badStart });
      fireEvent.click(fix("Fix start date"));
      await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Start")));
      fireEvent.click(button("Next")!);
      await waitFor(() => expect(document.activeElement?.id).toBe("draft-step-review-heading"));
      fireEvent.click(button("Back")!);
      await waitFor(() => expect(document.activeElement?.id).toBe("draft-step-run-heading"));
    });
  });

  it("goes from an Edit line on Review to the field on Run settings", async () => {
    wizard({ step: "review" });
    fireEvent.click(button("Edit cores")!);
    expect(heading()).toBe("Run settings");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Cores")));
  });

  it("shows the name typed on Run settings as a row on Review, and Edit returns focus to the Name input", async () => {
    wizard({ step: "run" });
    type("Colorado");
    fireEvent.click(button("Next")!);
    expect(screen.queryByLabelText("Name")).toBeNull();
    const row = screen.getByText("Name", { selector: "dt" }).parentElement as HTMLElement;
    expect(within(row).getByText("Colorado")).toBeTruthy();
    fireEvent.click(button("Edit name")!);
    expect(heading()).toBe("Run settings");
    await waitFor(() => expect(document.activeElement).toBe(nameInput()));
    expect(nameInput().value).toBe("Colorado");
  });

  it("says 'Not named yet' on Review for an unnamed draft, and lists no problem about it", () => {
    wizard({ step: "review" });
    const row = screen.getByText("Name", { selector: "dt" }).parentElement as HTMLElement;
    expect(within(row).getByText("Not named yet")).toBeTruthy();
    expect(screen.queryByText("Fix this to submit:")).toBeNull();
    expect((screen.getByRole("button", { name: "Submit to Anvil" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("opens the closed part of Run settings that holds the field an Edit line names", async () => {
    wizard({ step: "review" });
    fireEvent.click(button("Edit walltime")!);
    // Compute is a line and a button until asked for; the Edit link asks.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(/^Walltime/)));
    expect(screen.getByRole("button", { name: "Done with compute" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);

    fireEvent.click(button("Next")!);
    fireEvent.click(button("Edit output variables")!);
    await waitFor(() => expect(document.activeElement?.closest("[data-draft-field]")?.getAttribute("data-draft-field")).toBe("variables"));
    expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Done with output variables" })).toBeTruthy();
  });

  it("marks the step that has a problem, and nothing is blocked by it", () => {
    wizard({ step: "run", ctx: { dataset: yearly, snapshotState: "found" }, job: {
      ...JOB,
      parameters: { ...JOB.parameters, temporal_range_start: "2001-03-15" },
    } });
    expect(stepLink("Run settings").textContent).toContain("(needs attention)");
    expect(stepLink("Review & submit").textContent).not.toContain("(needs attention)");
    fireEvent.click(button("Next")!);
    expect(heading()).toBe("Review & submit");
    // The list of what is in the way is beside the Submit button.
    expect(screen.getByText("Fix this to submit:")).toBeTruthy();
  });
});

// Hidden too: a dialog open over the page hides it from the accessibility tree.
const saveButtons = () =>
  screen.getAllByRole("button", { name: /^Save draft$|^Saving…$/, hidden: true }) as HTMLButtonElement[];
const pressSave = () => fireEvent.click(saveButtons()[0]);
/** A plain click on `el`: whether the leave guard held it back, with jsdom
 *  never asked to follow a link. The probe sits after the guard on the same
 *  node and phase, so it sees what the guard did. */
function click(el: Element): boolean {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
  let heldBack = false;
  const probe = (e: Event) => {
    heldBack = e.defaultPrevented;
    e.preventDefault();
  };
  document.addEventListener("click", probe, true);
  act(() => void el.dispatchEvent(event));
  document.removeEventListener("click", probe, true);
  return heldBack;
}
const outsideLink = (href: string) => {
  const a = document.createElement("a");
  a.setAttribute("href", href);
  a.textContent = "elsewhere";
  document.body.append(a);
  return a;
};
const keydown = (init: KeyboardEventInit) => {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  act(() => void document.dispatchEvent(event));
  return event;
};

describe("saving is a button", () => {
  it("says Unsaved changes after an edit, sends nothing, and the button is on", async () => {
    wizard({ step: "run" });
    expect(screen.getByText("Saved", { exact: false })).toBeTruthy();
    type("Colorado");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    expect(saveButtons().every((b) => !b.disabled)).toBe(true);
    await pause(1_500);
    expect(updateDraft).not.toHaveBeenCalled();
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
  });

  it("Save draft sends the edit in one request, shows Saving… and then Saved, and says so in a toast", async () => {
    let answer!: (r: ActionResult<Job>) => void;
    updateDraft.mockReturnValue(new Promise((r) => (answer = r)));
    wizard({ step: "run" });
    type("Colorado");
    pressSave();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Saving…" })).toHaveLength(2));
    expect(screen.getByText("Saving…", { selector: "span span, span" })).toBeTruthy();
    expect(saveButtons().every((b) => b.disabled)).toBe(true);
    await act(async () => answer({ ok: true, data: { ...JOB, about: { name: "Colorado" }, updated_at: "2026-10-01T12:00:05.000Z" } }));

    expect(updateDraft).toHaveBeenCalledTimes(1);
    expect(updateDraft).toHaveBeenCalledWith("job-1", { about: { name: "Colorado", description: null } });
    expect(screen.getByText("Saved", { exact: false })).toBeTruthy();
    expect(screen.queryByText("Unsaved changes")).toBeNull();
    expect(toast.success).toHaveBeenCalledWith("Draft saved");
    expect(readDraftCache("job-1")?.about).toEqual({ name: "Colorado" });
  });

  it("is off when there is nothing to save, and says why in a tooltip and to a screen reader", () => {
    wizard({ step: "run" });
    const [header, bottom] = saveButtons();
    expect(header.disabled).toBe(true);
    expect(bottom.disabled).toBe(true);
    expect(header.closest("span[title]")?.getAttribute("title")).toBe("No changes to save");
    expect(header.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.getElementById(header.getAttribute("aria-describedby")!)?.textContent).toBe("No changes to save");
  });

  it("is on again for the next edit, and off again once saved", async () => {
    wizard({ step: "run" });
    type("Colorado");
    pressSave();
    await waitFor(() => expect(saveButtons()[0].disabled).toBe(true));
    await waitFor(() => expect(screen.getByText("Saved", { exact: false })).toBeTruthy());
    type("Colorado 2");
    expect(saveButtons()[0].disabled).toBe(false);
  });

  it("is also under Run settings, and does the same; Review has the header's only", async () => {
    wizard({ step: "run" });
    expect(saveButtons()).toHaveLength(2);
    type("Colorado");
    fireEvent.click(saveButtons()[1]);
    await waitFor(() => expect(updateDraft).toHaveBeenCalledTimes(1));
    fireEvent.click(button("Next")!);
    expect(saveButtons()).toHaveLength(1);
  });

  it("is not pressed twice by a double click", async () => {
    wizard({ step: "run" });
    type("Colorado");
    pressSave();
    pressSave();
    await settle();
    expect(updateDraft).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it("changing step saves nothing: not Next, not the strip, not the browser's back, not focus leaving", async () => {
    wizard({ step: "run" });
    const input = nameInput();
    input.focus();
    type("Colorado");
    fireEvent.blur(input, { relatedTarget: document.body });
    fireEvent.click(stepLink("Review & submit"));
    expect(heading()).toBe("Review & submit");
    act(() => {
      window.history.replaceState(null, "", "/workspace/job-1?step=run");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(heading()).toBe("Run settings");
    fireEvent.click(button("Next")!);
    await pause(1_500);
    expect(updateDraft).not.toHaveBeenCalled();
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
  });

  it("the tab being hidden or the page being hidden saves nothing", async () => {
    wizard({ step: "run" });
    type("Colorado");
    hold("hidden");
    fireEvent(document, new Event("visibilitychange"));
    fireEvent(window, new Event("pagehide"));
    await pause(1_500);
    hold("visible");
    expect(updateDraft).not.toHaveBeenCalled();
  });

  it("closing the page without saving sends nothing", async () => {
    const view = wizard({ step: "run" });
    type("Colorado");
    view.unmount();
    await pause(1_200);
    expect(updateDraft).not.toHaveBeenCalled();
  });
});

describe("Ctrl/Cmd+S", () => {
  it("saves, and keeps the browser's own save-page dialog away, with Ctrl and with Cmd", async () => {
    wizard({ step: "run" });
    type("Colorado");
    const event = keydown({ key: "s", ctrlKey: true });
    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(updateDraft).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(saveButtons()[0].disabled).toBe(true));

    type("Colorado 2");
    expect(keydown({ key: "S", metaKey: true }).defaultPrevented).toBe(true);
    await waitFor(() => expect(updateDraft).toHaveBeenCalledTimes(2));
  });

  it("still keeps the browser's dialog away when there is nothing to save, and sends nothing", async () => {
    wizard({ step: "run" });
    expect(keydown({ key: "s", ctrlKey: true }).defaultPrevented).toBe(true);
    await settle();
    expect(updateDraft).not.toHaveBeenCalled();
  });

  it("is only the plain chord: Ctrl+Shift+S, Alt and a bare S are left alone", () => {
    wizard({ step: "run" });
    type("Colorado");
    expect(keydown({ key: "s", ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false);
    expect(keydown({ key: "s", ctrlKey: true, altKey: true }).defaultPrevented).toBe(false);
    expect(keydown({ key: "s" }).defaultPrevented).toBe(false);
    expect(updateDraft).not.toHaveBeenCalled();
  });

  it("is stopped when the page is gone from under it: the listener is removed on unmount", () => {
    const view = wizard({ step: "run" });
    view.unmount();
    expect(keydown({ key: "s", ctrlKey: true }).defaultPrevented).toBe(false);
  });
});

describe("leaving a stored draft", () => {
  afterEach(() => document.body.querySelectorAll("a").forEach((a) => a.remove()));

  it("asks nothing while nothing is unsaved: links just go, and the browser is not asked", () => {
    wizard({ step: "run" });
    expect(click(screen.getByRole("link", { name: "My snapshot drafts" }))).toBe(false);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
  });

  it("holds back a link click once something is unsaved, and offers Save draft, Discard changes and Keep editing", async () => {
    wizard({ step: "run" });
    type("Colorado");
    expect(click(screen.getByRole("link", { name: "My snapshot drafts" }))).toBe(true);
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Leave without saving?");
    expect(within(dialog).getByRole("button", { name: "Save draft" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Discard changes" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Keep editing" })).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Save as draft" })).toBeNull();
  });

  it("asks the browser once, before a reload, while something is unsaved", () => {
    wizard({ step: "run" });
    type("Colorado");
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
  });

  it("does not ask when the edit was undone, or about the wizard's own step links", () => {
    wizard({ step: "run" });
    type("Colorado");
    click(stepLink("Review & submit"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(heading()).toBe("Review & submit");
    fireEvent.click(button("Back")!);
    type("");
    expect(click(screen.getByRole("link", { name: "My snapshot drafts" }))).toBe(false);
  });

  it("Keep editing closes it, goes nowhere and keeps the edit", async () => {
    wizard({ step: "run" });
    type("Colorado");
    click(outsideLink("/repository"));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(push).not.toHaveBeenCalled();
    expect(nameInput().value).toBe("Colorado");
    expect(updateDraft).not.toHaveBeenCalled();
  });

  it("Discard changes goes to the link without saving", async () => {
    wizard({ step: "run" });
    type("Colorado");
    click(outsideLink("/repository?q=wbm"));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Discard changes" }));
    expect(push).toHaveBeenCalledWith("/repository?q=wbm");
    await pause(1_200);
    expect(updateDraft).not.toHaveBeenCalled();
    // Nothing asks about the navigation that is under way.
    expect(click(outsideLink("/workspace"))).toBe(false);
  });

  it("Save draft saves it, then goes to the link", async () => {
    wizard({ step: "run" });
    type("Colorado");
    click(outsideLink("/repository"));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/repository"));
    expect(updateDraft).toHaveBeenCalledTimes(1);
    expect(updateDraft).toHaveBeenCalledWith("job-1", { about: { name: "Colorado", description: null } });
    expect(toast.success).toHaveBeenCalledWith("Draft saved");
  });

  it("stays when the save fails: the dialog closes, the edit and the failure are on the page", async () => {
    updateDraft.mockResolvedValue({ ok: false, reason: "error", message: "Server error", status: 503 });
    wizard({ step: "run" });
    type("Colorado");
    click(outsideLink("/repository"));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByText("Couldn't save")).toBeTruthy();
    expect(nameInput().value).toBe("Colorado");
  });

  it("does not ask while the Delete dialog has saving suspended", async () => {
    wizard({ step: "run" });
    type("Colorado");
    await openDeleteDialog();
    expect(screen.getByText("Saving is paused")).toBeTruthy();
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
  });
});

describe("leaving a stored draft with the browser's Back and Forward", () => {
  const RUN = "/workspace/job-1?step=run";
  const at = () => window.location.pathname + window.location.search;
  let nav: FakeNavigation;
  const press = (delta: number) => act(async () => nav.go(delta));
  beforeEach(() => {
    // The list, then the draft on Run settings.
    nav = new FakeNavigation(["/workspace", RUN]);
  });
  afterEach(() => nav.uninstall());

  it("asks, with Save draft, Discard changes and Keep editing, when Back would leave an unsaved draft", async () => {
    wizard({ step: "run" });
    type("Colorado");
    await press(-1);
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Leave without saving?");
    expect(within(dialog).getByRole("button", { name: "Save draft" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Discard changes" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Keep editing" })).toBeTruthy();
    expect(at()).toBe(RUN);
    expect(nav.index).toBe(1);
    expect(nav.entries).toHaveLength(2);
    expect(updateDraft).not.toHaveBeenCalled();
  });

  it("Keep editing stays with the edit, and a later Back asks again", async () => {
    wizard({ step: "run" });
    type("Colorado");
    await press(-1);
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(at()).toBe(RUN);
    expect(nameInput().value).toBe("Colorado");
    expect(updateDraft).not.toHaveBeenCalled();
    await press(-1);
    await screen.findByRole("alertdialog");
  });

  it("Discard changes goes where Back was going, without saving", async () => {
    wizard({ step: "run" });
    type("Colorado");
    await press(-1);
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect(at()).toBe("/workspace"));
    expect(nav.index).toBe(0);
    await pause(1_200);
    expect(updateDraft).not.toHaveBeenCalled();
  });

  it("Save draft saves it, then goes where Back was going", async () => {
    wizard({ step: "run" });
    type("Colorado");
    await press(-1);
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(at()).toBe("/workspace"));
    expect(updateDraft).toHaveBeenCalledTimes(1);
    expect(updateDraft).toHaveBeenCalledWith("job-1", { about: { name: "Colorado", description: null } });
    expect(toast.success).toHaveBeenCalledWith("Draft saved");
    expect(push).not.toHaveBeenCalled();
  });

  it("stays when the save fails: the dialog closes, the address is the draft's, the failure is on the page", async () => {
    updateDraft.mockResolvedValue({ ok: false, reason: "error", message: "Server error", status: 503 });
    wizard({ step: "run" });
    type("Colorado");
    await press(-1);
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(at()).toBe(RUN);
    expect(nav.index).toBe(1);
    expect(screen.getByText("Couldn't save")).toBeTruthy();
    expect(nameInput().value).toBe("Colorado");
  });

  it("never asks about its own steps, and the entry out of them is still the one asked about", async () => {
    wizard({ step: "run" });
    type("Colorado");
    fireEvent.click(button("Next")!);
    expect(heading()).toBe("Review & submit");
    await press(-1);
    await waitFor(() => expect(heading()).toBe("Run settings"));
    await press(1);
    await waitFor(() => expect(heading()).toBe("Review & submit"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await press(-1);
    await press(-1);
    await screen.findByRole("alertdialog");
    expect(at()).toBe(RUN);
    expect(nameInput().value).toBe("Colorado");
  });

  it("does nothing while everything is saved: Back just goes, and the step does not flip on the way out", async () => {
    wizard({ step: "run" });
    await press(-1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(at()).toBe("/workspace");
    expect(nav.index).toBe(0);
  });

  it("does not ask again once the draft is saved by its button", async () => {
    wizard({ step: "run" });
    type("Colorado");
    fireEvent.click(screen.getAllByRole("button", { name: "Save draft" })[0]);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Draft saved"));
    await press(-1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(at()).toBe("/workspace");
  });
});

describe("the status and the button for each state", () => {
  it("failed: Couldn't save with Retry, which does not retry by itself", async () => {
    updateDraft.mockResolvedValue({ ok: false, reason: "error", message: "Server error", status: 503 });
    wizard({ step: "run" });
    type("Colorado");
    pressSave();
    expect(await screen.findByText("Couldn't save")).toBeTruthy();
    await pause(3_000);
    expect(updateDraft).toHaveBeenCalledTimes(1);

    updateDraft.mockImplementation(fakeServer());
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(updateDraft).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText("Couldn't save")).toBeNull());
    expect(screen.getByText("Your changes are saved.")).toBeTruthy();
  });

  it("refused: names the field, and the button is off with its reason", async () => {
    updateDraft.mockResolvedValue({ ok: false, reason: "error", message: "Too many cores", status: 422, fields: ["slurm_config.cores"] });
    wizard({ step: "run" });
    type("Colorado");
    pressSave();
    expect(await screen.findByRole("button", { name: /^fix / })).toBeTruthy();
    expect(saveButtons()[0].disabled).toBe(true);
    expect(saveButtons()[0].closest("span[title]")?.getAttribute("title")).toBe("Fix the settings that can't be saved first");
  });
});

describe("when the draft cannot be saved", () => {
  it("says the session expired, and keeps what was typed", async () => {
    updateDraft.mockResolvedValue({ ok: false, reason: "session_expired" });
    wizard({ step: "run" });
    type("Colorado");
    pressSave();
    expect(await screen.findByText("Your session has expired.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign in" })).toBeTruthy();
    fireEvent.click(stepLink("Run settings"));
    expect(nameInput().value).toBe("Colorado");
  });

  it("says it was submitted or changed elsewhere, and Reload asks the server for the page again", async () => {
    updateDraft.mockResolvedValue({ ok: false, reason: "error", message: "Only drafts can be edited", status: 409 });
    wizard({ step: "run" });
    type("Colorado");
    pressSave();
    const banner = await screen.findByText("This snapshot draft was submitted or changed elsewhere");
    expect(banner.closest('[role="alert"]')).not.toBeNull();
    expect(refresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("says it was deleted, with a way back to the list", async () => {
    updateDraft.mockResolvedValue({ ok: false, reason: "not_found" });
    wizard({ step: "run" });
    type("Colorado");
    pressSave();
    expect(await screen.findByText("This draft was deleted")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to My snapshot drafts" }).getAttribute("href")).toBe("/workspace");
    expect(screen.getByText("Not saved")).toBeTruthy();
  });

  it("shows no banner while all is well", () => {
    wizard();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Your session has expired.")).toBeNull();
  });
});

async function openDeleteDialog() {
  fireEvent.click(screen.getByRole("button", { name: "Delete snapshot draft" }));
  await screen.findByText("Delete this snapshot draft?");
}

describe("deleting the draft", () => {
  it("stops saving, deletes, and goes to the list", async () => {
    deleteDraft.mockResolvedValue({ ok: true, data: null });
    wizard({ step: "run" });
    type("Colorado");
    await openDeleteDialog();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete snapshot draft" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/workspace"));
    expect(push).toHaveBeenCalledTimes(1);
    expect(deleteDraft).toHaveBeenCalledWith("job-1");

    // The edit that was waiting is not sent after the draft is gone.
    await pause(1_200);
    expect(updateDraft).not.toHaveBeenCalled();
  });

  it("allows saving again when the dialog is cancelled, and saves nothing by itself", async () => {
    wizard({ step: "run" });
    type("Colorado");
    await openDeleteDialog();
    // Nothing is saved behind an open Delete dialog.
    expect(screen.getByText("Saving is paused")).toBeTruthy();
    expect(saveButtons()[0].disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    await waitFor(() => expect(screen.getByText("Unsaved changes")).toBeTruthy());
    await pause(1_500);
    expect(updateDraft).not.toHaveBeenCalled();
    expect(saveButtons()[0].disabled).toBe(false);
    pressSave();
    await waitFor(() => expect(updateDraft).toHaveBeenCalledTimes(1));
    expect(push).not.toHaveBeenCalled();
    expect(deleteDraft).not.toHaveBeenCalled();
  });

  it("allows saving again, and says why, when the delete is refused", async () => {
    deleteDraft.mockResolvedValue({ ok: false, reason: "error", message: "Anvil can't be reached." });
    wizard({ step: "run" });
    type("Colorado");
    await openDeleteDialog();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete snapshot draft" }));
    expect(await screen.findByText("Anvil can't be reached.")).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText("Unsaved changes")).toBeTruthy());
    await pause(1_500);
    expect(updateDraft).not.toHaveBeenCalled();
  });
});

describe("coming back to the tab", () => {
  const later = { ...JOB, about: { name: "Changed elsewhere" }, updated_at: "2026-10-01T13:00:00.000Z" };

  afterEach(() => hold("visible"));

  it("loads the server's copy when it moved on and nothing is unsaved", async () => {
    fetchJob.mockResolvedValue({ ok: true, data: later });
    wizard({ step: "run" });
    expect(nameInput().value).toBe("");
    hold("visible");
    fireEvent(document, new Event("visibilitychange"));
    await waitFor(() => expect(nameInput().value).toBe("Changed elsewhere"));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Changed elsewhere");
    expect(fetchJob).toHaveBeenCalledWith("job-1");
    // It is the new baseline: nothing to save.
    await pause(1_000);
    expect(updateDraft).not.toHaveBeenCalled();
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
    wizard({ step: "run" });
    hold("visible");
    fireEvent(document, new Event("visibilitychange"));
    await waitFor(() => expect(fetchJob).toHaveBeenCalledTimes(1));
    await settle();
    expect(refresh).not.toHaveBeenCalled();
    expect(nameInput().value).toBe("");
  });

  it("does not look while something is unsaved", async () => {
    wizard({ step: "run" });
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
    wizard({ step: "run" });
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
    wizard({ step: "run" });
    expect(nameInput().value).toBe("Saved in this tab");
  });

  it("takes the server's copy when that is the newer one", () => {
    writeDraftCache({ ...JOB, about: { name: "Old" }, updated_at: "2026-10-01T11:00:00.000Z" });
    wizard({ step: "run", job: { ...JOB, about: { name: "Server's" } } });
    expect(nameInput().value).toBe("Server's");
  });

  it("starts over from a different copy the server page sends later", () => {
    const view = wizard({ step: "run" });
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
    wizard({ step: "run" });
    type("Colorado");
    fireEvent.click(button("Next")!);
    const dialog = await openSubmitDialog();
    // The flush ran before the dialog opened.
    expect(updateDraft).toHaveBeenCalledTimes(1);
    expect(updateDraft.mock.calls[0][1]).toEqual({ about: { name: "Colorado", description: null } });
    expect(dialog.textContent).toContain("Fake Snapshot");
    expect(dialog.textContent).toContain("2001-01-01 to 2001-12-31");

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(submitDraft).not.toHaveBeenCalled();
    // Cancelling leaves saving available, and sends nothing by itself.
    fireEvent.click(button("Back")!);
    type("Colorado 2");
    await pause(1_200);
    expect(updateDraft).toHaveBeenCalledTimes(1);
    pressSave();
    await waitFor(() => expect(updateDraft).toHaveBeenCalledTimes(2));
  });

  it("says Submit saves the changes first, not that the draft saves itself", () => {
    wizard();
    expect(screen.getByText(/Submitting saves your changes first/)).toBeTruthy();
    expect(screen.queryByText(/saves automatically/)).toBeNull();
  });

  it("opens the simulation's page when it goes through", async () => {
    submitDraft.mockResolvedValue({ ok: true, data: SUBMITTED });
    wizard();
    confirm(await openSubmitDialog());
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/workspace/job-1"));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(submitDraft).toHaveBeenCalledWith("job-1");
  });

  it("switches the inputs off while it is submitting", async () => {
    let answer!: (r: ActionResult<Job>) => void;
    submitDraft.mockReturnValue(new Promise((r) => (answer = r)));
    wizard();
    confirm(await openSubmitDialog());
    const editRunPeriod = () => screen.getByRole("button", { name: "Edit run period", hidden: true });
    await waitFor(() => expect((editRunPeriod().closest("fieldset") as HTMLFieldSetElement).disabled).toBe(true));
    // Radix hides the page behind its dialog from the accessibility tree.
    expect((screen.getByRole("button", { name: "Back", hidden: true }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => answer({ ok: true, data: SUBMITTED }));
  });

  it("saves again after a submit that failed, without remounting, and shows why", async () => {
    submitDraft.mockResolvedValue({ ok: false, reason: "error", message: "Anvil said no", code: "sbatch_rejected" });
    fetchJob.mockResolvedValue({
      ok: true,
      data: { ...JOB, last_submit_error: { code: "sbatch_rejected", message: "Anvil said no", at: "2026-10-01T12:05:00Z" } },
    });
    wizard();
    const edit = screen.getByRole("button", { name: "Edit run period" });
    confirm(await openSubmitDialog());
    await waitFor(() => expect(screen.getAllByRole("alert").some((a) => a.textContent?.includes("Anvil said no"))).toBe(true));
    await waitFor(() => expect(fetchJob).toHaveBeenCalledWith("job-1"));
    // The same controls: nothing was remounted, and they work again.
    expect(screen.getByRole("button", { name: "Edit run period" })).toBe(edit);
    await waitFor(() => expect((edit.closest("fieldset") as HTMLFieldSetElement).disabled).toBe(false));
    expect(updateDraft).not.toHaveBeenCalled();

    fireEvent.click(edit);
    type("After the failure");
    await pause(1_200);
    expect(updateDraft).not.toHaveBeenCalled();
    pressSave();
    await waitFor(() => expect(updateDraft).toHaveBeenCalledTimes(1));
    expect(updateDraft.mock.calls[0][1]).toEqual({ about: { name: "After the failure", description: null } });
    expect(replace).not.toHaveBeenCalled();
  });

  it("does not save behind a submit that is out", async () => {
    let answer!: (r: ActionResult<Job>) => void;
    submitDraft.mockReturnValue(new Promise((r) => (answer = r)));
    wizard();
    confirm(await openSubmitDialog());
    await waitFor(() => expect(submitDraft).toHaveBeenCalled());
    expect(screen.getByText("Saving is paused")).toBeTruthy();
    await pause(1_000);
    expect(updateDraft).not.toHaveBeenCalled();
    await act(async () => answer({ ok: true, data: SUBMITTED }));
  });

  it("takes the success path when the answer did not come but the job moved on", async () => {
    submitDraft.mockRejectedValue(new Error("timed out"));
    fetchJob.mockResolvedValue({ ok: true, data: { ...JOB, status: "PENDING" } });
    wizard();
    confirm(await openSubmitDialog());
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/workspace/job-1"));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Submitted — opening the job page…")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the 'could not confirm' message when the job is still a draft", async () => {
    submitDraft.mockRejectedValue(new Error("timed out"));
    wizard();
    confirm(await openSubmitDialog());
    await waitFor(() => expect(screen.getAllByRole("alert").some((a) => a.textContent?.includes("Could not confirm"))).toBe(true));
    expect(replace).not.toHaveBeenCalled();
  });

  it("cannot be started while the draft needs attention", () => {
    wizard({ blockedReason: "Your account has not been approved to run simulations." });
    expect((screen.getByRole("button", { name: "Submit to Anvil" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Your account has not been approved to run simulations.")).toBeTruthy();
  });
});

describe("after a submit went through: the page that does not follow", () => {
  const SUBMITTED = { ...JOB, status: "PENDING" as const };
  const PAGE = "/workspace/job-1";
  const assign = vi.fn();

  /** jsdom's `location.assign` cannot be replaced, so replace the location with
   *  one that reads the real one and has an `assign` of its own. */
  function stubLocation() {
    const real = window.location;
    vi.stubGlobal("location", {
      get search() {
        return real.search;
      },
      get pathname() {
        return real.pathname;
      },
      get href() {
        return real.href;
      },
      assign,
    });
  }

  beforeEach(() => {
    assign.mockReset();
    stubLocation();
    // Only timers: the promises, Radix and Testing Library keep running as usual.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** Submit, with the wizard staying on screen (the mocked router does nothing). */
  async function submitAndStay() {
    submitDraft.mockResolvedValue({ ok: true, data: SUBMITTED });
    const view = wizard();
    fireEvent.click(screen.getByRole("button", { name: "Submit to Anvil" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit to Anvil" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith(PAGE));
    fetchJob.mockClear();
    return view;
  }
  const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

  it("hides the old error as soon as the submit goes through", async () => {
    const view = render(
      <DraftWizard
        job={{ ...JOB, last_submit_error: { code: "sbatch_rejected", message: "QOSMaxWallDurationPerJobLimit", at: "2026-10-02T00:00:00Z" } }}
        ctx={FOUND}
        blockedReason={null}
        initialStep="review"
      />
    );
    expect(screen.getByRole("alert").textContent).toContain("The last submit didn't go through");
    submitDraft.mockResolvedValue({ ok: true, data: SUBMITTED });
    fireEvent.click(screen.getByRole("button", { name: "Submit to Anvil" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit to Anvil" }));
    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(screen.queryByText(/QOSMaxWallDurationPerJobLimit/)).toBeNull();
    expect(screen.getByText("Submitted — opening the job page…")).toBeTruthy();
    view.unmount();
  });

  it("does nothing more while Next is still doing the navigation", async () => {
    await submitAndStay();
    await advance(2_400);
    expect(fetchJob).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it("navigates the hard way when the job has left DRAFT and the wizard is still there", async () => {
    await submitAndStay();
    fetchJob.mockResolvedValue({ ok: true, data: SUBMITTED });
    await advance(2_500);
    expect(fetchJob).toHaveBeenCalledWith("job-1");
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith(PAGE);
    expect(screen.queryByRole("link", { name: "Open the job page" })).toBeNull();
  });

  it("never navigates when the wizard has gone away", async () => {
    const view = await submitAndStay();
    fetchJob.mockResolvedValue({ ok: true, data: SUBMITTED });
    view.unmount();
    await advance(20_000);
    expect(fetchJob).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it("does not navigate for an answer that arrives after the wizard went away", async () => {
    const view = await submitAndStay();
    let answer!: (r: ActionResult<Job>) => void;
    fetchJob.mockReturnValue(new Promise((r) => (answer = r)));
    await advance(2_500);
    expect(fetchJob).toHaveBeenCalledTimes(1);
    view.unmount();
    await act(async () => answer({ ok: true, data: SUBMITTED }));
    expect(assign).not.toHaveBeenCalled();
  });

  it("asks again every 2 s while it is still a draft, and navigates when it is not", async () => {
    await submitAndStay();
    fetchJob.mockResolvedValue({ ok: true, data: JOB });
    await advance(2_500);
    expect(fetchJob).toHaveBeenCalledTimes(1);
    await advance(1_900);
    expect(fetchJob).toHaveBeenCalledTimes(1);
    await advance(100);
    expect(fetchJob).toHaveBeenCalledTimes(2);
    fetchJob.mockResolvedValue({ ok: false, reason: "error", message: "down" });
    await advance(2_000);
    expect(fetchJob).toHaveBeenCalledTimes(3);
    expect(assign).not.toHaveBeenCalled();
    fetchJob.mockResolvedValue({ ok: true, data: SUBMITTED });
    await advance(2_000);
    expect(fetchJob).toHaveBeenCalledTimes(4);
    expect(assign).toHaveBeenCalledWith(PAGE);
  });

  it("counts a poll that throws as 'still a draft'", async () => {
    await submitAndStay();
    fetchJob.mockRejectedValue(new Error("network"));
    await advance(2_500 + 3 * 2_000);
    expect(fetchJob).toHaveBeenCalledTimes(4);
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Open the job page" })).toBeTruthy();
  });

  it("gives up after 3 retries and links to the job page instead", async () => {
    await submitAndStay();
    fetchJob.mockResolvedValue({ ok: true, data: JOB });
    await advance(2_500 + 2_000 + 2_000);
    expect(screen.queryByRole("link", { name: "Open the job page" })).toBeNull();
    await advance(2_000);
    expect(fetchJob).toHaveBeenCalledTimes(4);
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByText(/The submit went through but this page did not update\./)).toBeTruthy();
    const link = screen.getByRole("link", { name: "Open the job page" });
    expect(link.getAttribute("href")).toBe(PAGE);
    // And it stops asking.
    await advance(30_000);
    expect(fetchJob).toHaveBeenCalledTimes(4);
  });

  it("does the same hard navigation after a lost answer once the job turns out to be submitted", async () => {
    submitDraft.mockRejectedValue(new Error("timed out"));
    fetchJob.mockResolvedValue({ ok: true, data: SUBMITTED });
    wizard();
    fireEvent.click(screen.getByRole("button", { name: "Submit to Anvil" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit to Anvil" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith(PAGE));
    expect(assign).not.toHaveBeenCalled();
    await advance(2_500);
    expect(assign).toHaveBeenCalledWith(PAGE);
  });
});
