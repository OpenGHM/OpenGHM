import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ActionResult, Job, DraftUpdateRequest } from "@/lib/jobs/types";
import type { DraftContext } from "@/lib/workspace/draft-state";
import type { DraftStep } from "@/lib/workspace/draft-wizard";

const { deriveDraft, updateDraft, fetchJob, submitDraft, deleteDraft, push, replace, refresh, toast } =
  vi.hoisted(() => ({
    deriveDraft: vi.fn(),
    updateDraft: vi.fn(),
    fetchJob: vi.fn(),
    submitDraft: vi.fn(),
    deleteDraft: vi.fn(),
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
  deleteDraft,
  duplicateDraft: vi.fn(),
}));
// These tests are about saving and submitting: no published results are looked
// up (draft-wizard-published.test.tsx covers the lookup).
vi.mock("@/lib/workspace/use-published-answer", () => ({
  usePublishedAnswer: () => ({ state: { status: "none" }, refresh: () => {} }),
}));
// Nor are the rules of the parameter tree checked (draft-wizard-checks.test.tsx covers them).
vi.mock("@/lib/workspace/use-draft-checks", () => ({
  useDraftChecks: () => ({ status: "none" }),
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
import { FakeNavigation } from "@/lib/workspace/fake-navigation";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const dataset = fakeDataset({ runStartAlignment: "none" });
const FOUND: DraftContext = { dataset, snapshotState: "found" };
const BASE_PATH = `/workspace/new/${dataset.id}`;

/** The draft the server would create: its defaults, and no id. */
const PREVIEW = fakeDraft("DRAFT", {
  id: "",
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
  slurm_config: { cores: 8 },
});
/** What deriving it stores. */
const CREATED: Job = { ...PREVIEW, id: "new-1", updated_at: "2026-10-01T12:00:01.000Z" };

/** A server that keeps the name it is sent. */
function updateImpl(initial: Job = CREATED) {
  let current = initial;
  let n = 1;
  return async (_id: string, patch: DraftUpdateRequest): Promise<ActionResult<Job>> => {
    n += 1;
    current = {
      ...current,
      about: patch.about ? { ...(patch.about.name ? { name: patch.about.name } : {}) } : current.about,
      parameters: patch.parameters ?? current.parameters,
      updated_at: new Date(Date.UTC(2026, 9, 1, 12, 0, n)).toISOString(),
    };
    return { ok: true, data: current };
  };
}

beforeEach(() => {
  clearDraftCache();
  for (const m of [deriveDraft, updateDraft, fetchJob, submitDraft, deleteDraft, push, replace, refresh]) {
    m.mockReset();
  }
  for (const m of Object.values(toast)) m.mockReset();
  deriveDraft.mockResolvedValue({ ok: true, data: CREATED });
  updateDraft.mockImplementation(updateImpl());
  fetchJob.mockResolvedValue({ ok: true, data: CREATED });
});
afterEach(() => {
  cleanup();
  document.body.querySelectorAll("a").forEach((a) => a.remove());
  document.body.style.pointerEvents = "";
});

function wizard(props: Partial<React.ComponentProps<typeof DraftWizard>> & { step?: DraftStep } = {}) {
  const { step = "run", ...rest } = props;
  window.history.replaceState(null, "", `${BASE_PATH}?step=${step}`);
  return render(
    <DraftWizard
      job={PREVIEW}
      mode={{ kind: "new", datasetId: dataset.id }}
      ctx={FOUND}
      blockedReason={null}
      initialStep={step}
      {...rest}
    />
  );
}

const heading = () => screen.getByRole("heading", { level: 2 }).textContent;
const h1 = () => screen.getByRole("heading", { level: 1 }).textContent;
const nameInput = () => screen.getByLabelText("Name") as HTMLInputElement;
const type = (value: string) => fireEvent.change(nameInput(), { target: { value } });
const saveButtons = () => screen.getAllByRole("button", { name: /^Save as draft$|^Saving…$/ }) as HTMLButtonElement[];
const settle = () => act(async () => {});
const pause = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));
const outsideLink = (href: string) => {
  const a = document.createElement("a");
  a.setAttribute("href", href);
  a.textContent = "elsewhere";
  document.body.append(a);
  return a;
};
/** A plain click on `el`. Reports whether the guard held it back (the event was
 *  already prevented when the probe, registered after the guard on the same
 *  node and phase, saw it); jsdom is not asked to follow a link either way. */
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

describe("a new snapshot draft: what the page says", () => {
  it("opens on Run settings, titled New snapshot, badged Not saved, with no id anywhere", () => {
    wizard();
    expect(heading()).toBe("Run settings");
    expect(h1()).toBe("New snapshot");
    expect(screen.getByText("Not saved")).toBeTruthy();
    expect(screen.queryByText("Draft")).toBeNull();
    expect(screen.getByText("Not saved yet")).toBeTruthy();
    expect(screen.queryByText(/Saved/)).toBeNull();
    expect(document.body.textContent).not.toContain("Untitled");
    expect(screen.getByRole("link", { name: "Based on Fake Snapshot" }).getAttribute("href")).toBe(`/repository/${dataset.id}`);
    // Nothing that belongs to a stored draft.
    expect(screen.queryByRole("button", { name: "Delete snapshot draft" })).toBeNull();
    expect(screen.getByRole("link", { name: "Cancel" }).getAttribute("href")).toBe("/workspace");
  });

  it("follows the name as it is typed, and goes back to New snapshot when it is cleared", () => {
    wizard();
    type("  Colorado basin ");
    expect(h1()).toBe("Colorado basin");
    expect(screen.getByRole("navigation", { name: "Breadcrumb" }).textContent).toContain("Colorado basin");
    type("   ");
    expect(h1()).toBe("New snapshot");
  });

  it("focuses the empty Name on open", () => {
    wizard();
    expect(document.activeElement).toBe(nameInput());
  });

  it("offers Save as draft in the header and under Run settings, and not on Review", () => {
    wizard();
    expect(saveButtons()).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(saveButtons()).toHaveLength(1);
  });

  it("draws Not saved as a dashed amber pill in the band, and offers Next: Review there on Run settings only", () => {
    wizard();
    const pill = screen.getByText("Not saved");
    expect(pill.className).toContain("border-dashed");
    expect(pill.className).toContain("border-hero-attention");
    const next = screen.getByRole("button", { name: "Next: Review" });
    expect(next.closest("nav")).toBeNull();
    fireEvent.click(next);
    expect(heading()).toBe("Review & submit");
    expect(screen.queryByRole("button", { name: "Next: Review" })).toBeNull();
  });

  it("addresses its steps under /workspace/new/<snapshot>, and changes step without leaving", () => {
    wizard();
    expect(screen.getByRole("link", { name: /Review & submit/ }).getAttribute("href")).toBe(`${BASE_PATH}?step=review`);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(window.location.pathname + window.location.search).toBe(`${BASE_PATH}?step=review`);
    expect(heading()).toBe("Review & submit");
    expect(document.activeElement?.id).toContain("review");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(window.location.search).toBe("?step=run");
    expect(heading()).toBe("Run settings");
  });

  it("goes back to Run settings, not Review, when the browser goes back to an address with no step", async () => {
    wizard();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    window.history.replaceState(null, "", BASE_PATH);
    fireEvent(window, new PopStateEvent("popstate"));
    await waitFor(() => expect(heading()).toBe("Run settings"));
  });
});

describe("a new snapshot draft: nothing is saved by itself", () => {
  it("sends nothing while it is edited, however long it waits, and not when the step changes", async () => {
    wizard();
    type("Colorado");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    nameInput().focus();
    nameInput().blur();
    await pause(1_500);
    expect(deriveDraft).not.toHaveBeenCalled();
    expect(updateDraft).not.toHaveBeenCalled();
    expect(fetchJob).not.toHaveBeenCalled();
    expect(screen.getByText("Not saved yet")).toBeTruthy();
  });

  it("does not look at the server when the tab comes back into view", async () => {
    wizard();
    type("Colorado");
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    fireEvent(document, new Event("visibilitychange"));
    await settle();
    expect(fetchJob).not.toHaveBeenCalled();
    expect(nameInput().value).toBe("Colorado");
  });
});

describe("Save as draft", () => {
  it("creates the draft, saves what was typed into it, opens it on the same step and says so", async () => {
    wizard();
    type("Colorado");
    fireEvent.click(saveButtons()[0]);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/workspace/new-1?step=run"));
    expect(deriveDraft).toHaveBeenCalledTimes(1);
    expect(deriveDraft).toHaveBeenCalledWith(dataset.id);
    expect(updateDraft).toHaveBeenCalledTimes(1);
    expect(updateDraft).toHaveBeenCalledWith("new-1", { about: { name: "Colorado", description: null } });
    expect(toast.success).toHaveBeenCalledWith("Snapshot draft saved");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("opens the step it was pressed on", async () => {
    wizard({ step: "review" });
    // Review has the header's button.
    fireEvent.click(saveButtons()[0]);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/workspace/new-1?step=review"));
  });

  it("sends no patch when nothing was changed, and still creates the draft", async () => {
    wizard();
    fireEvent.click(saveButtons()[0]);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/workspace/new-1?step=run"));
    expect(updateDraft).not.toHaveBeenCalled();
  });

  it("is off with a spinner while it saves, and never creates two drafts from a double click", async () => {
    let answer!: (r: ActionResult<Job>) => void;
    deriveDraft.mockReturnValue(new Promise((r) => (answer = r)));
    wizard();
    type("Colorado");
    const [header, bottom] = saveButtons();
    fireEvent.click(header);
    fireEvent.click(header);
    fireEvent.click(bottom);
    await waitFor(() => expect(deriveDraft).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Saving…" })).toHaveLength(2));
    expect(saveButtons().every((b) => b.disabled)).toBe(true);
    await act(async () => answer({ ok: true, data: CREATED }));
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    // Still off while the page opens the draft.
    expect(saveButtons().every((b) => b.disabled)).toBe(true);
    expect(deriveDraft).toHaveBeenCalledTimes(1);
  });

  it("shows a failed create under the header, keeps every input and stays on the page", async () => {
    deriveDraft.mockResolvedValue({ ok: false, reason: "error", message: "Backend exploded" });
    wizard();
    type("Colorado");
    fireEvent.click(saveButtons()[0]);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Backend exploded");
    expect(replace).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(nameInput().value).toBe("Colorado");
    expect(saveButtons().every((b) => !b.disabled)).toBe(true);
    expect(screen.getByText("Not saved yet")).toBeTruthy();

    // Trying again creates it.
    deriveDraft.mockResolvedValue({ ok: true, data: CREATED });
    fireEvent.click(saveButtons()[0]);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/workspace/new-1?step=run"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the sign-in banner for an ended session", async () => {
    deriveDraft.mockResolvedValue({ ok: false, reason: "session_expired" });
    wizard();
    fireEvent.click(saveButtons()[0]);
    expect(await screen.findByText("Your session has expired.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it("opens the draft even when its settings could not be saved, and says which", async () => {
    updateDraft.mockResolvedValue({ ok: false, reason: "error", message: "Server error", status: 503 });
    wizard();
    type("Colorado");
    fireEvent.click(saveButtons()[0]);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/workspace/new-1?step=run"));
    expect(toast.error).toHaveBeenCalledWith(
      "The snapshot draft was saved, but these settings weren't: Name. Open it to set them again."
    );
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe("Ctrl/Cmd+S in a new snapshot draft", () => {
  const keydown = (init: KeyboardEventInit) => {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
    act(() => void document.dispatchEvent(event));
    return event;
  };

  it("is Save as draft: it creates the draft once, and keeps the browser's own dialog away", async () => {
    wizard();
    type("Colorado");
    expect(keydown({ key: "s", metaKey: true }).defaultPrevented).toBe(true);
    keydown({ key: "s", ctrlKey: true });
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/workspace/new-1?step=run"));
    expect(deriveDraft).toHaveBeenCalledTimes(1);
    expect(updateDraft).toHaveBeenCalledWith("new-1", { about: { name: "Colorado", description: null } });
    expect(replace).toHaveBeenCalledTimes(1);
  });
});

describe("leaving a new snapshot draft", () => {
  it("asks nothing before anything has changed: Cancel and links just go", () => {
    wizard();
    expect(click(screen.getByRole("link", { name: "Cancel" }))).toBe(false);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
  });

  it("asks the browser before a reload or a closed tab once something changed, and not again when the change is undone", () => {
    wizard();
    type("Colorado");
    const on = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(on);
    expect(on.defaultPrevented).toBe(true);
    type("");
    const off = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(off);
    expect(off.defaultPrevented).toBe(false);
  });

  it("holds back a click on Cancel or a header link once something changed, and offers three ways on", async () => {
    wizard();
    type("Colorado");
    expect(click(screen.getByRole("link", { name: "Cancel" }))).toBe(true);
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Leave without saving?");
    expect(within(dialog).getByRole("button", { name: "Save as draft" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Discard changes" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Keep editing" })).toBeTruthy();
  });

  it("does not ask about the wizard's own step links", () => {
    wizard();
    type("Colorado");
    // The strip handles it itself (and prevents the page load), without a dialog.
    click(screen.getByRole("link", { name: /Review & submit/ }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(heading()).toBe("Review & submit");
  });

  it("Keep editing closes the dialog, keeps everything, and goes nowhere", async () => {
    wizard();
    type("Colorado");
    click(outsideLink("/repository"));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(push).not.toHaveBeenCalled();
    expect(nameInput().value).toBe("Colorado");
    expect(deriveDraft).not.toHaveBeenCalled();
  });

  it("Discard changes goes to the link and creates nothing", async () => {
    wizard();
    type("Colorado");
    click(outsideLink("/repository?q=wbm"));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Discard changes" }));
    expect(push).toHaveBeenCalledWith("/repository?q=wbm");
    expect(deriveDraft).not.toHaveBeenCalled();
    expect(updateDraft).not.toHaveBeenCalled();
    // The prompt is off from here on: nothing asks about this navigation.
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
  });

  it("Save as draft saves it and then goes to the link", async () => {
    wizard();
    type("Colorado");
    click(outsideLink("/repository"));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Save as draft" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/repository"));
    expect(deriveDraft).toHaveBeenCalledTimes(1);
    expect(updateDraft).toHaveBeenCalledWith("new-1", { about: { name: "Colorado", description: null } });
    expect(toast.success).toHaveBeenCalledWith("Snapshot draft saved");
    expect(replace).not.toHaveBeenCalled();
  });

  it("stays on the page, with the error, when the save from the dialog fails to create", async () => {
    deriveDraft.mockResolvedValue({ ok: false, reason: "error", message: "Backend exploded" });
    wizard();
    type("Colorado");
    click(outsideLink("/repository"));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Save as draft" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(push).not.toHaveBeenCalled();
    expect((await screen.findByRole("alert")).textContent).toContain("Backend exploded");
    expect(nameInput().value).toBe("Colorado");
  });

  it("stops asking once Save as draft went through and the page is on its way", async () => {
    wizard();
    type("Colorado");
    fireEvent.click(saveButtons()[0]);
    await waitFor(() => expect(replace).toHaveBeenCalled());
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
    expect(click(outsideLink("/workspace"))).toBe(false);
  });
});

describe("leaving a new snapshot draft with the browser's Back and Forward", () => {
  const RUN = `${BASE_PATH}?step=run`;
  const REVIEW = `${BASE_PATH}?step=review`;
  const at = () => window.location.pathname + window.location.search;
  let nav: FakeNavigation;
  /** The browser's history as it was when the wizard opened: the page before it, then the wizard. */
  const history = (urls = ["/workspace", RUN], index?: number) => {
    nav = new FakeNavigation(urls, index);
  };
  const press = (delta: number) => act(async () => nav.go(delta));
  afterEach(() => nav?.uninstall());

  it("asks, with the same three ways on, when Back would leave a changed wizard, and stays where it is", async () => {
    history();
    wizard();
    type("Colorado");
    await press(-1);
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Leave without saving?");
    expect(within(dialog).getByRole("button", { name: "Save as draft" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Discard changes" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Keep editing" })).toBeTruthy();
    // The address is the wizard's again, and nothing was added to the history.
    expect(at()).toBe(RUN);
    expect(nav.index).toBe(1);
    expect(nav.entries).toHaveLength(2);
    expect(push).not.toHaveBeenCalled();
  });

  it("asks for a Forward that would leave it too", async () => {
    history(["/workspace", RUN, "/repository"], 1);
    wizard();
    type("Colorado");
    await press(1);
    await screen.findByRole("alertdialog");
    expect(at()).toBe(RUN);
    expect(nav.index).toBe(1);
  });

  it("Keep editing stays on the wizard with every input, and a later Back asks again", async () => {
    history();
    wizard();
    type("Colorado");
    await press(-1);
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(at()).toBe(RUN);
    expect(heading()).toBe("Run settings");
    expect(nameInput().value).toBe("Colorado");
    expect(deriveDraft).not.toHaveBeenCalled();

    await press(-1);
    await screen.findByRole("alertdialog");
    expect(nameInput().value).toBe("Colorado");
  });

  it("Discard changes goes where Back was going, and creates nothing", async () => {
    history();
    wizard();
    type("Colorado");
    await press(-1);
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect(at()).toBe("/workspace"));
    expect(nav.index).toBe(0);
    expect(nav.entries).toHaveLength(2);
    expect(deriveDraft).not.toHaveBeenCalled();
    expect(updateDraft).not.toHaveBeenCalled();
    // Nothing asks about the move, the browser included.
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
  });

  it("Save as draft saves it and then goes where Back was going, not to the new draft", async () => {
    history();
    wizard();
    type("Colorado");
    await press(-1);
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Save as draft" }));
    await waitFor(() => expect(at()).toBe("/workspace"));
    expect(deriveDraft).toHaveBeenCalledTimes(1);
    expect(updateDraft).toHaveBeenCalledWith("new-1", { about: { name: "Colorado", description: null } });
    expect(toast.success).toHaveBeenCalledWith("Snapshot draft saved");
    expect(replace).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("stays, with the error, when the save from the dialog fails", async () => {
    deriveDraft.mockResolvedValue({ ok: false, reason: "error", message: "Backend exploded" });
    history();
    wizard();
    type("Colorado");
    await press(-1);
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Save as draft" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(at()).toBe(RUN);
    expect(nav.index).toBe(1);
    expect((await screen.findByRole("alert")).textContent).toContain("Backend exploded");
    expect(nameInput().value).toBe("Colorado");
  });

  it("never asks about moving between its own steps, by the buttons, the strip or the browser", async () => {
    history();
    wizard();
    type("Colorado");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(heading()).toBe("Review & submit");
    expect(nav.urls().map((u) => new URL(u).pathname + new URL(u).search)).toEqual(["/workspace", RUN, REVIEW]);

    await press(-1);
    await waitFor(() => expect(heading()).toBe("Run settings"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(nameInput().value).toBe("Colorado");

    await press(1);
    await waitFor(() => expect(heading()).toBe("Review & submit"));
    expect(screen.queryByRole("alertdialog")).toBeNull();

    // And the way out from here still asks, and Back from Run settings is the way out.
    await press(-1);
    await press(-1);
    await screen.findByRole("alertdialog");
    expect(at()).toBe(RUN);
    expect(nameInput().value).toBe("Colorado");
  });

  it("does not touch the history while nothing has changed", async () => {
    history();
    wizard();
    await press(-1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(at()).toBe("/workspace");
    expect(nav.index).toBe(0);
  });

  it("does not ask once the change is undone", async () => {
    history();
    wizard();
    type("Colorado");
    type("");
    await press(-1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(at()).toBe("/workspace");
  });

  it("does not misfire after Save as draft: the page is on its way to the draft", async () => {
    history();
    wizard();
    type("Colorado");
    fireEvent.click(saveButtons()[0]);
    await waitFor(() => expect(replace).toHaveBeenCalled());
    // Next swaps the address for the draft's; the guard is off by then.
    act(() => window.history.replaceState(null, "", `/workspace/new-1?step=run`));
    await press(-1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(at()).toBe("/workspace");
    expect(nav.entries).toHaveLength(2);
  });
});

describe("Submit from Review", () => {
  const SUBMITTED = { ...CREATED, status: "PENDING" as const };

  async function openSubmitDialog() {
    fireEvent.click(screen.getByRole("button", { name: "Submit to Anvil" }));
    return screen.findByRole("alertdialog");
  }
  const confirm = (dialog: HTMLElement) =>
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit to Anvil" }));

  it("says that Submit saves the draft first", () => {
    wizard({ step: "review" });
    expect(screen.getByText(/Submitting saves your changes first/)).toBeTruthy();
    expect(screen.queryByText(/saves automatically/)).toBeNull();
  });

  it("creates the draft before the confirmation, which shows what it holds, and Cancel submits nothing", async () => {
    wizard();
    type("Colorado");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    const dialog = await openSubmitDialog();
    expect(deriveDraft).toHaveBeenCalledTimes(1);
    expect(updateDraft).toHaveBeenCalledWith("new-1", { about: { name: "Colorado", description: null } });
    expect(dialog.textContent).toContain("Fake Snapshot");
    expect(dialog.textContent).toContain("2001-01-01 to 2001-12-31");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(submitDraft).not.toHaveBeenCalled();
    // The draft exists and holds the name: leaving now loses nothing, so nothing asks.
    expect(screen.getByText("Draft saved")).toBeTruthy();
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
  });

  it("submits the draft it created, and opens the simulation's page", async () => {
    submitDraft.mockResolvedValue({ ok: true, data: SUBMITTED });
    wizard({ step: "review" });
    confirm(await openSubmitDialog());
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/workspace/new-1"));
    expect(submitDraft).toHaveBeenCalledWith("new-1");
    expect(submitDraft).toHaveBeenCalledTimes(1);
    expect(deriveDraft).toHaveBeenCalledTimes(1);
    // Nothing asks about leaving a page that has been submitted.
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
  });

  it("opens the saved draft on Review, and says so, when the submit did not go through", async () => {
    submitDraft.mockResolvedValue({ ok: false, reason: "error", message: "Anvil said no", code: "sbatch_rejected" });
    wizard({ step: "review" });
    confirm(await openSubmitDialog());
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/workspace/new-1?step=review"));
    expect(toast.error).toHaveBeenCalledWith("Your snapshot draft was saved, but it was not submitted. Anvil said no");
    expect(deriveDraft).toHaveBeenCalledTimes(1);
  });

  it("does not submit, and does not create twice, when the draft could not be saved", async () => {
    deriveDraft.mockResolvedValueOnce({ ok: false, reason: "error", message: "Backend exploded" });
    wizard({ step: "review" });
    fireEvent.click(screen.getByRole("button", { name: "Submit to Anvil" }));
    await waitFor(() =>
      expect(screen.getAllByRole("alert").some((a) => a.textContent?.includes("could not be saved, so nothing was submitted"))).toBe(true)
    );
    expect(screen.getAllByRole("alert").some((a) => a.textContent?.includes("Backend exploded"))).toBe(true);
    expect(submitDraft).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();

    // Again: creates it this time, once.
    const dialog = await openSubmitDialog();
    expect(deriveDraft).toHaveBeenCalledTimes(2);
    expect(dialog).toBeTruthy();
  });

  it("a retry after the settings could not be sent finds the draft and does not derive again", async () => {
    updateDraft
      .mockResolvedValueOnce({ ok: false, reason: "error", message: "Server error", status: 503 })
      .mockImplementation(updateImpl());
    wizard();
    type("Colorado");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit to Anvil" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(toast.error.mock.calls[0][0]).toContain("The snapshot draft was created, but its settings could not be saved");

    const dialog = await openSubmitDialog();
    expect(dialog).toBeTruthy();
    expect(deriveDraft).toHaveBeenCalledTimes(1);
    expect(updateDraft).toHaveBeenCalledTimes(2);
  });
});
