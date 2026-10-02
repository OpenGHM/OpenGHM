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
/** A snapshot of model `version`, so each has a short name of its own. */
const snap = (id: string, name: string, version: string) =>
  fakeDataset({
    id,
    about: { ...fakeDataset().about, name },
    uses: { ...fakeDataset().uses, container: { ...fakeDataset().uses.container, version } },
  });
const USED = snap("snap-used", "Used Snapshot", "1.0.0");
const LISTED = snap("snap-listed", "Listed Snapshot", "2.0.0");
const SEED: PickerSeed = {
  filters: FILTERS,
  data: { items: [LISTED, USED], totalCount: 2, totalPages: 1, page: 1 },
  modelInputIds: new Set(),
};
const JOB = fakeSimulation("FAILED", { id: "job-1", sim_id: "sim-1", dataset_title: "Global WBM" });
const COPY_PAGE = { items: [JOB], page: 1, totalPages: 1 };

function start(over: Partial<React.ComponentProps<typeof StartFrom>> = {}) {
  return render(
    <StartFrom
      initialMode="snapshot"
      usedIds={["snap-used"]}
      snapshotNames={{ [JOB.dataset_id]: "WBM 1.0.0 · 2000–2009" }}
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
const row = () => within(screen.getByRole("list", { name: "Your simulations" })).getByRole("listitem");
/** A snapshot card's one control, by its short name. */
const snapshotButton = (version: string) => screen.getByRole("button", { name: `WBM ${version} · 2001` });
const pickerMounted = () => screen.queryByRole("list", { name: "Model snapshots" }) !== null;

beforeEach(() => {
  for (const m of [deriveSimulation, duplicateSimulation, fetchJobs, fetchDatasets, fetchModelInputIds, push]) m.mockReset();
  fetchModelInputIds.mockResolvedValue(new Set());
  window.history.replaceState(null, "", "/workspace/new");
});

const modeLink = (name: RegExp) => screen.getByRole("link", { name });
const SNAPSHOT_MODE = /^Model snapshot/;
const COPY_MODE = /^Copy a simulation/;

describe("the switch", () => {
  it("opens on Model snapshot, with the grid, and writes nothing to the URL", () => {
    start();
    expect(modeLink(SNAPSHOT_MODE).getAttribute("aria-current")).toBe("true");
    expect(modeLink(COPY_MODE).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Choose a model snapshot");
    expect(pickerMounted()).toBe(true);
    expect(window.location.search).toBe("");
  });

  it("is a small segmented control, not two cards", () => {
    start();
    const nav = screen.getByRole("navigation", { name: "Where to start from" });
    expect(within(nav).getAllByRole("link")).toHaveLength(2);
    expect(nav.textContent).toBe("Model snapshotCopy a simulation");
  });

  it("switches with pushState: ?from=copy, and back to the default with no query", () => {
    start();
    fireEvent.click(modeLink(COPY_MODE));
    expect(window.location.pathname + window.location.search).toBe("/workspace/new?from=copy");
    expect(modeLink(COPY_MODE).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Choose a simulation to copy");
    expect(screen.getByRole("button", { name: "Copy sim-1" })).toBeTruthy();
    fireEvent.click(modeLink(SNAPSHOT_MODE));
    expect(window.location.pathname + window.location.search).toBe("/workspace/new");
    expect(modeLink(SNAPSHOT_MODE).getAttribute("aria-current")).toBe("true");
  });

  it("follows the browser's back and forward", () => {
    start();
    fireEvent.click(modeLink(COPY_MODE));
    // jsdom's history is asynchronous; set the URL and send the event it would.
    window.history.replaceState(null, "", "/workspace/new");
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(modeLink(SNAPSHOT_MODE).getAttribute("aria-current")).toBe("true");
    window.history.replaceState(null, "", "/workspace/new?from=copy");
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(modeLink(COPY_MODE).getAttribute("aria-current")).toBe("true");
  });

  it("opens on the copy list for ?from=copy and mounts the picker only for the snapshot mode", () => {
    window.history.replaceState(null, "", "/workspace/new?from=copy");
    start({ initialMode: "copy" });
    expect(modeLink(COPY_MODE).getAttribute("aria-current")).toBe("true");
    expect(pickerMounted()).toBe(false);
    expect(screen.getByRole("list", { name: "Your simulations" })).toBeTruthy();
  });

  it("has no section of its own for the snapshots the user has used", () => {
    start();
    expect(screen.queryByText("Model snapshots you've used")).toBeNull();
    expect(screen.queryByText("Browse model snapshots")).toBeNull();
  });

  it("offers no model input mode: nothing that cannot be chosen is shown", () => {
    start();
    expect(screen.queryByText(/Start from a published model input/)).toBeNull();
    expect(screen.queryByText(/Coming soon/)).toBeNull();
    expect(screen.queryByText(/Not available yet/)).toBeNull();
  });

  it("is not shown when there is nothing to copy, and the grid is what is left", () => {
    window.history.replaceState(null, "", "/workspace/new?from=copy");
    start({ initialMode: "copy", copyInitial: { items: [], page: 1, totalPages: 1 } });
    expect(screen.queryByRole("navigation", { name: "Where to start from" })).toBeNull();
    expect(screen.queryByText("You have no simulations to copy yet")).toBeNull();
    // The URL asked for the copy list, but there is nothing in it: the default shows.
    expect(pickerMounted()).toBe(true);
  });

  it("keeps the copy mode when the first page could not be read", () => {
    start({ copyInitial: null });
    expect(modeLink(COPY_MODE)).toBeTruthy();
  });
});

describe("the snapshot grid", () => {
  it("marks the snapshot the user has used and lists it first", () => {
    start();
    const items = within(screen.getByRole("list", { name: "Model snapshots" })).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    // The server's order was Listed, Used.
    expect(items[0].textContent).toContain("Used Snapshot");
    expect(items[0].textContent).toContain("Used before");
    expect(items[1].textContent).toContain("Listed Snapshot");
    expect(items[1].textContent).not.toContain("Used before");
  });

  it("has no search, no Filters and no count for a short catalogue, and uses the server's result", () => {
    start();
    expect(fetchDatasets).not.toHaveBeenCalled();
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Filters/ })).toBeNull();
    expect(screen.queryByText(/model snapshots$/)).toBeNull();
  });
});

describe("a model snapshot", () => {
  it("is derived at once from a click on its card, and opens Run settings", async () => {
    deriveSimulation.mockResolvedValue(created("d1"));
    start();
    fireEvent.click(snapshotButton("1.0.0"));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/workspace/d1?step=run"));
    expect(deriveSimulation).toHaveBeenCalledWith("snap-used");
  });

  it("is derived from the Select in a snapshot's Details sheet, which closes first", async () => {
    deriveSimulation.mockResolvedValue(created("d4"));
    start();
    fireEvent.click(screen.getByRole("button", { name: /^Details: Listed Snapshot/ }));
    const sheet = await screen.findByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: /select/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/workspace/d4?step=run"));
    expect(deriveSimulation).toHaveBeenCalledWith("snap-listed");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("turns every card off while one is pending, with a message on the clicked one, and creates one draft", async () => {
    let resolve!: (r: ActionResult<Job>) => void;
    deriveSimulation.mockReturnValue(new Promise((r) => (resolve = r)));
    start();
    const used = snapshotButton("1.0.0");
    fireEvent.click(used);
    fireEvent.click(used);
    expect(deriveSimulation).toHaveBeenCalledTimes(1);
    expect((used as HTMLButtonElement).disabled).toBe(true);
    expect(used.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("status").textContent).toContain("Creating your draft");
    expect(used.closest("[data-slot=card]")?.contains(screen.getByRole("status"))).toBe(true);
    // The other card is out of reach too.
    fireEvent.click(snapshotButton("2.0.0"));
    expect(deriveSimulation).toHaveBeenCalledTimes(1);
    await act(async () => resolve(created("d3")));
    expect(push).toHaveBeenCalledWith("/workspace/d3?step=run");
  });

  it("shows a missing snapshot in an alert and lets the user try again", async () => {
    deriveSimulation.mockResolvedValueOnce({ ok: false, reason: "not_found" });
    start();
    fireEvent.click(snapshotButton("1.0.0"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("no longer in the repository");
    expect(push).not.toHaveBeenCalled();
    expect((snapshotButton("1.0.0") as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows any other error, and the sign-in banner for an expired session", async () => {
    deriveSimulation.mockResolvedValueOnce({ ok: false, reason: "error", message: "Backend exploded" });
    start();
    fireEvent.click(snapshotButton("1.0.0"));
    expect((await screen.findByRole("alert")).textContent).toContain("Backend exploded");

    deriveSimulation.mockResolvedValueOnce({ ok: false, reason: "session_expired" });
    fireEvent.click(snapshotButton("1.0.0"));
    expect(await screen.findByText("Your session has expired.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("copying a simulation", () => {
  beforeEach(() => window.history.replaceState(null, "", "/workspace/new?from=copy"));

  it("duplicates the row and opens Run settings of the new draft", async () => {
    duplicateSimulation.mockResolvedValue(created("c1"));
    start({ initialMode: "copy" });
    fireEvent.click(screen.getByRole("button", { name: "Copy sim-1" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/workspace/c1?step=run"));
    expect(duplicateSimulation).toHaveBeenCalledWith("job-1");
  });

  it("names the row's snapshot in short", () => {
    start({ initialMode: "copy" });
    expect(row().textContent).toContain("WBM 1.0.0 · 2000–2009");
    expect(row().textContent).not.toContain("Global WBM");
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

  it("does not carry an error from one mode to the other", async () => {
    deriveSimulation.mockResolvedValue({ ok: false, reason: "error", message: "Snapshot trouble" });
    window.history.replaceState(null, "", "/workspace/new");
    start();
    fireEvent.click(snapshotButton("1.0.0"));
    await screen.findByRole("alert");
    fireEvent.click(modeLink(COPY_MODE));
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
    // A search is already narrowing the list, so the controls are there to undo it.
    expect((screen.getByRole("searchbox", { name: "Search model snapshots" }) as HTMLInputElement).value).toBe("wbm");
    expect(screen.getByText("1", { selector: "strong" }).parentElement?.textContent).toContain("1 model snapshot");
  });
});
