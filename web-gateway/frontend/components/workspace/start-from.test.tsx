import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ActionResult, Job } from "@/lib/jobs/types";

const { deriveSimulation, duplicateSimulation, fetchJobs, fetchDatasets, fetchModelInputIds, push } = vi.hoisted(() => ({
  deriveSimulation: vi.fn(),
  duplicateSimulation: vi.fn(),
  fetchJobs: vi.fn(),
  fetchDatasets: vi.fn(),
  fetchModelInputIds: vi.fn(),
  push: vi.fn(),
}));
vi.mock("@/lib/jobs/actions", () => ({ deriveSimulation, duplicateSimulation, fetchJobs }));
vi.mock("@/lib/repository/actions", () => ({ fetchDatasets, fetchModelInputIds }));
// The address bar is the router: what a test pushes is what `useSearchParams` reads.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import { StartFrom, type PickerSeed } from "@/components/workspace/start-from";
import { fakeDataset, fakeSimulation } from "@/lib/workspace/fixtures";
import type { FilterState } from "@/lib/repository/types";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(cleanup);

const FILTERS: FilterState = {
  searchQuery: "",
  temporalCoverageStart: null,
  temporalCoverageEnd: null,
  spatialResMin: null,
  spatialResMax: null,
  sortBy: "relevance",
  page: 1,
};
const RECENT = fakeDataset({ id: "snap-recent", about: { ...fakeDataset().about, name: "Recent Snapshot" } });
const LISTED = fakeDataset({ id: "snap-listed", about: { ...fakeDataset().about, name: "Listed Snapshot" } });
const SEED: PickerSeed = {
  filters: FILTERS,
  data: { items: [LISTED], totalCount: 1, totalPages: 1, page: 1 },
  modelInputIds: new Set(),
};
const JOB = fakeSimulation("FAILED", { id: "job-1", sim_id: "sim-1", dataset_title: "Global WBM" });
const COPY_PAGE = { items: [JOB], page: 1, totalPages: 1 };

function start(over: Partial<React.ComponentProps<typeof StartFrom>> = {}) {
  return render(
    <StartFrom
      initialMode="snapshot"
      recentSnapshots={[RECENT]}
      copyInitial={COPY_PAGE}
      picker={SEED}
      {...over}
    />
  );
}

const created = (id = "new-draft"): ActionResult<Job> => ({
  ok: true,
  data: fakeSimulation("DRAFT", { id }),
});
const card = (name: RegExp) => screen.getByRole("link", { name });
const row = () => within(screen.getByRole("list", { name: "Your simulations" })).getByRole("listitem");
const pickerMounted = () => screen.queryByRole("searchbox", { name: "Search model snapshots" }) !== null;

beforeEach(() => {
  for (const m of [deriveSimulation, duplicateSimulation, fetchJobs, fetchDatasets, fetchModelInputIds, push]) m.mockReset();
  fetchModelInputIds.mockResolvedValue(new Set());
  window.history.replaceState(null, "", "/workspace/new");
});

describe("the cards", () => {
  it("open on the model snapshot card, with the picker, and write nothing to the URL", () => {
    start();
    expect(card(/^Model snapshot/).getAttribute("aria-current")).toBe("true");
    expect(card(/^Copy one of my simulations/).getAttribute("aria-current")).toBeNull();
    expect(pickerMounted()).toBe(true);
    expect(window.location.search).toBe("");
  });

  it("switch with pushState: ?from=copy, and back to the default with no query", () => {
    start();
    fireEvent.click(card(/^Copy one of my simulations/));
    expect(window.location.pathname + window.location.search).toBe("/workspace/new?from=copy");
    expect(card(/^Copy one of my simulations/).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("button", { name: "Copy sim-1" })).toBeTruthy();
    fireEvent.click(card(/^Model snapshot/));
    expect(window.location.pathname + window.location.search).toBe("/workspace/new");
    expect(card(/^Model snapshot/).getAttribute("aria-current")).toBe("true");
  });

  it("follow the browser's back and forward", () => {
    start();
    fireEvent.click(card(/^Copy one of my simulations/));
    // jsdom's history is asynchronous; set the URL and send the event it would.
    window.history.replaceState(null, "", "/workspace/new");
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(card(/^Model snapshot/).getAttribute("aria-current")).toBe("true");
    window.history.replaceState(null, "", "/workspace/new?from=copy");
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(card(/^Copy one of my simulations/).getAttribute("aria-current")).toBe("true");
  });

  it("open on the copy card for ?from=copy and mount the picker only for the snapshot card", () => {
    window.history.replaceState(null, "", "/workspace/new?from=copy");
    start({ initialMode: "copy" });
    expect(card(/^Copy one of my simulations/).getAttribute("aria-current")).toBe("true");
    expect(pickerMounted()).toBe(false);
    expect(screen.getByRole("list", { name: "Your simulations" })).toBeTruthy();
    expect(screen.queryByText("Model snapshots you've used")).toBeNull();
  });

  it("make the model input card disabled: no link, no button, no handler", () => {
    start();
    const text = screen.getByText(/Start from a published model input/);
    const box = text.closest("[aria-disabled]") as HTMLElement;
    expect(box.getAttribute("aria-disabled")).toBe("true");
    expect(within(box).getByText("Coming soon")).toBeTruthy();
    expect(within(box).queryByRole("link")).toBeNull();
    expect(within(box).queryByRole("button")).toBeNull();
    expect(box.getAttribute("tabindex")).toBeNull();
    fireEvent.click(box);
    expect(window.location.search).toBe("");
    expect(screen.getByText(/Not available yet: a run needs a model snapshot's code and settings/)).toBeTruthy();
  });

  it("disable the copy card, with the reason, when there is nothing to copy", () => {
    window.history.replaceState(null, "", "/workspace/new?from=copy");
    start({ initialMode: "copy", copyInitial: { items: [], page: 1, totalPages: 1 } });
    expect(screen.queryByRole("link", { name: /Copy one of my simulations/ })).toBeNull();
    const box = screen.getByText("You have no simulations to copy yet").closest("[aria-disabled]");
    expect(box?.getAttribute("aria-disabled")).toBe("true");
    // The URL asked for the copy card, but there is nothing in it: the default shows.
    expect(card(/^Model snapshot/).getAttribute("aria-current")).toBe("true");
    expect(pickerMounted()).toBe(true);
  });

  it("keep the copy card on when the first page could not be read", () => {
    start({ copyInitial: null });
    expect(card(/^Copy one of my simulations/)).toBeTruthy();
  });
});

describe("a model snapshot", () => {
  it("is derived at once from the recent snapshots, and opens step 2", async () => {
    deriveSimulation.mockResolvedValue(created("d1"));
    start();
    fireEvent.click(screen.getByRole("button", { name: "Start from Recent Snapshot" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/workspace/d1?step=model"));
    expect(deriveSimulation).toHaveBeenCalledWith("snap-recent");
  });

  it("is derived at once from the picker's Select", async () => {
    deriveSimulation.mockResolvedValue(created("d2"));
    start();
    fireEvent.click(screen.getAllByRole("button", { name: /select/i })[0]);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/workspace/d2?step=model"));
    expect(deriveSimulation).toHaveBeenCalledWith("snap-listed");
  });

  it("is derived from the Select in a snapshot's Details sheet, which closes first", async () => {
    deriveSimulation.mockResolvedValue(created("d4"));
    start();
    fireEvent.click(screen.getAllByRole("button", { name: /^Details: Listed Snapshot/ })[0]);
    const sheet = await screen.findByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: /select/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/workspace/d4?step=model"));
    expect(deriveSimulation).toHaveBeenCalledWith("snap-listed");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("turns everything off while one is pending, with a spinner on the clicked one, and creates one draft", async () => {
    let resolve!: (r: ActionResult<Job>) => void;
    deriveSimulation.mockReturnValue(new Promise((r) => (resolve = r)));
    start();
    const recent = screen.getByRole("button", { name: "Start from Recent Snapshot" });
    fireEvent.click(recent);
    fireEvent.click(recent);
    expect(deriveSimulation).toHaveBeenCalledTimes(1);
    expect((recent as HTMLButtonElement).disabled).toBe(true);
    expect(recent.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("status").textContent).toContain("Creating your draft");
    // Select in the picker is out of reach too.
    fireEvent.click(screen.getAllByRole("button", { name: /select/i })[0]);
    expect(deriveSimulation).toHaveBeenCalledTimes(1);
    await act(async () => resolve(created("d3")));
    expect(push).toHaveBeenCalledWith("/workspace/d3?step=model");
  });

  it("shows a missing snapshot in an alert and lets the user try again", async () => {
    deriveSimulation.mockResolvedValueOnce({ ok: false, reason: "not_found" });
    start();
    fireEvent.click(screen.getByRole("button", { name: "Start from Recent Snapshot" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("no longer in the repository");
    expect(push).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Start from Recent Snapshot" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows any other error, and the sign-in banner for an expired session", async () => {
    deriveSimulation.mockResolvedValueOnce({ ok: false, reason: "error", message: "Backend exploded" });
    start();
    fireEvent.click(screen.getByRole("button", { name: "Start from Recent Snapshot" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Backend exploded");

    deriveSimulation.mockResolvedValueOnce({ ok: false, reason: "session_expired" });
    fireEvent.click(screen.getByRole("button", { name: "Start from Recent Snapshot" }));
    expect(await screen.findByText("Your session has expired.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("copying a simulation", () => {
  beforeEach(() => window.history.replaceState(null, "", "/workspace/new?from=copy"));

  it("duplicates the row and opens step 2 of the new draft", async () => {
    duplicateSimulation.mockResolvedValue(created("c1"));
    start({ initialMode: "copy" });
    fireEvent.click(screen.getByRole("button", { name: "Copy sim-1" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/workspace/c1?step=model"));
    expect(duplicateSimulation).toHaveBeenCalledWith("job-1");
  });

  it("puts a snapshot that is gone on its row, not in the page alert", async () => {
    duplicateSimulation.mockResolvedValue({
      ok: false,
      reason: "error",
      code: "snapshot_not_found",
      message: "The model snapshot this simulation is based on is no longer in the repository, so it can't be copied.",
    });
    start({ initialMode: "copy" });
    fireEvent.click(screen.getByRole("button", { name: "Copy sim-1" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("can't be copied");
    expect(within(row()).getByRole("alert")).toBe(alert);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(push).not.toHaveBeenCalled();
  });

  it("shows another failure in the page alert", async () => {
    duplicateSimulation.mockResolvedValue({ ok: false, reason: "error", message: "Nope" });
    start({ initialMode: "copy" });
    fireEvent.click(screen.getByRole("button", { name: "Copy sim-1" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Nope");
    expect(row().contains(alert)).toBe(false);
  });

  it("does not carry an error from one card to the other", async () => {
    deriveSimulation.mockResolvedValue({ ok: false, reason: "error", message: "Snapshot trouble" });
    window.history.replaceState(null, "", "/workspace/new");
    start();
    fireEvent.click(screen.getByRole("button", { name: "Start from Recent Snapshot" }));
    await screen.findByRole("alert");
    fireEvent.click(card(/^Copy one of my simulations/));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("the picker after the page loaded", () => {
  it("fetches its own first result when the URL's filters are not the ones the server read", async () => {
    fetchDatasets.mockResolvedValue({ items: [LISTED], totalCount: 1, totalPages: 1, page: 1 });
    window.history.replaceState(null, "", "/workspace/new?q=wbm");
    start();
    expect(screen.getByText("Loading model snapshots…")).toBeTruthy();
    await waitFor(() => expect(pickerMounted()).toBe(true));
    expect(fetchDatasets).toHaveBeenCalledWith(expect.objectContaining({ searchQuery: "wbm" }));
    expect((screen.getByRole("searchbox", { name: "Search model snapshots" }) as HTMLInputElement).value).toBe("wbm");
  });

  it("uses the server's result when the filters match", () => {
    start();
    expect(fetchDatasets).not.toHaveBeenCalled();
    expect(screen.getByText("1", { selector: "strong" }).parentElement?.textContent).toBe("1 model snapshot");
  });
});
