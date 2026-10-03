import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const { deriveSimulation, duplicateSimulation, fetchJobs, fetchSnapshots, fetchModelInputIds, push } = vi.hoisted(() => ({
  deriveSimulation: vi.fn(),
  duplicateSimulation: vi.fn(),
  fetchJobs: vi.fn(),
  fetchSnapshots: vi.fn(),
  fetchModelInputIds: vi.fn(),
  push: vi.fn(),
}));
vi.mock("@/lib/jobs/actions", () => ({ deriveSimulation, duplicateSimulation, fetchJobs }));
vi.mock("@/lib/repository/actions", () => ({ fetchSnapshots, fetchModelInputIds }));
// The address bar is the router: what a test pushes is what `useSearchParams` reads.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import { filters as catalogueFilters, response } from "@/components/repository/catalogue.fixtures";
import { StartFrom, type PickerSeed } from "@/components/workspace/start-from";
import { fakeDataset } from "@/lib/workspace/fixtures";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(cleanup);

const snap = (id: string, name: string, version: string) => ({
  ...fakeDataset({
    id,
    about: { ...fakeDataset().about, name },
    uses: { ...fakeDataset().uses, container: { ...fakeDataset().uses.container, version } },
  }),
  kind: "snapshot" as const,
});
const USED = snap("snap-used", "Used Snapshot", "1.0.0");
const LISTED = snap("snap-listed", "Listed Snapshot", "2.0.0");
const SEED: PickerSeed = {
  filters: catalogueFilters(),
  data: response([LISTED, USED]),
  modelInputIds: new Set(),
};

function start(over: Partial<React.ComponentProps<typeof StartFrom>> = {}) {
  return render(<StartFrom usedIds={["snap-used"]} picker={SEED} {...over} />);
}

/** A snapshot card's one control, by the snapshot's title. */
const snapshotButton = (title: string) => screen.getByRole("button", { name: title });

beforeEach(() => {
  for (const m of [deriveSimulation, duplicateSimulation, fetchJobs, fetchSnapshots, fetchModelInputIds, push]) m.mockReset();
  fetchModelInputIds.mockResolvedValue(new Set());
  window.history.replaceState(null, "", "/workspace/new");
});

describe("Start from", () => {
  it("is one step: Choose a model snapshot, with the snapshot grid", () => {
    start();
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Choose a model snapshot");
    expect(screen.getByRole("list", { name: "Model snapshots" })).toBeTruthy();
    expect(window.location.search).toBe("");
  });

  it("does not offer to copy a simulation: that is done from the simulation's own page", () => {
    start();
    expect(screen.queryByText(/Copy a simulation/)).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Where to start from" })).toBeNull();
    expect(screen.queryByRole("list", { name: "Your simulations" })).toBeNull();
    expect(fetchJobs).not.toHaveBeenCalled();
    expect(duplicateSimulation).not.toHaveBeenCalled();
  });

  it("ignores ?from=copy: the snapshot grid is what there is", () => {
    window.history.replaceState(null, "", "/workspace/new?from=copy");
    start();
    expect(screen.getByRole("list", { name: "Model snapshots" })).toBeTruthy();
    expect(screen.queryByText(/Copy a simulation/)).toBeNull();
  });

  it("offers no model input mode: nothing that cannot be chosen is shown", () => {
    start();
    expect(screen.queryByText(/Start from a published model input/)).toBeNull();
    expect(screen.queryByText(/Coming soon/)).toBeNull();
    expect(screen.queryByText(/Not available yet/)).toBeNull();
  });
});

describe("the snapshot grid", () => {
  it("names each snapshot by its title, marks the one the user has used and lists it first", () => {
    start();
    const items = within(screen.getByRole("list", { name: "Model snapshots" })).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    // The server's order was Listed, Used.
    expect(within(items[0]).getByRole("heading", { level: 3 }).textContent).toBe("Used Snapshot");
    expect(items[0].textContent).toContain("Used before");
    expect(within(items[1]).getByRole("heading", { level: 3 }).textContent).toBe("Listed Snapshot");
    expect(items[1].textContent).not.toContain("Used before");
  });

  it("has the search, the Filters and the count even for two snapshots, and uses the server's result", () => {
    start();
    expect(fetchSnapshots).not.toHaveBeenCalled();
    expect(screen.getByRole("searchbox", { name: "Search model snapshots" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Filters/ })).toBeTruthy();
    expect(screen.getByText("2", { selector: "strong" }).parentElement?.textContent).toBe("2 model snapshots");
  });

  it("starts in the error state, with its own Retry, when the server could not read the snapshots", () => {
    start({ picker: { ...SEED, data: null } });
    expect(screen.getByRole("alert").textContent).toContain("Model snapshots could not be loaded");
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("opens with the search and filters of the URL, which the server read for", () => {
    window.history.replaceState(null, "", "/workspace/new?q=wbm&tag=tutorial");
    start({ picker: { ...SEED, filters: catalogueFilters({ searchQuery: "wbm", tag: ["tutorial"] }) } });
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("wbm");
    expect(screen.getByRole("button", { name: "Remove filter: Tag: Tutorial" })).toBeTruthy();
  });
});

describe("a model snapshot", () => {
  it("opens Run settings of a new simulation from a click on its card, and creates nothing", () => {
    start();
    fireEvent.click(snapshotButton("Used Snapshot"));
    expect(push).toHaveBeenCalledWith("/workspace/new/snap-used?step=run");
    expect(push).toHaveBeenCalledTimes(1);
    expect(deriveSimulation).not.toHaveBeenCalled();
    expect(duplicateSimulation).not.toHaveBeenCalled();
  });

  it("opens the same from the Select in a snapshot's Details sheet, which closes first", async () => {
    start();
    fireEvent.click(screen.getByRole("button", { name: /^Details: Listed Snapshot/ }));
    const sheet = await screen.findByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: /select/i }));
    expect(push).toHaveBeenCalledWith("/workspace/new/snap-listed?step=run");
    expect(deriveSimulation).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("encodes a snapshot id that is not a plain path segment", () => {
    const odd = snap("a/b c", "Odd Snapshot", "1.0.0");
    start({ picker: { ...SEED, data: response([odd]) } });
    fireEvent.click(snapshotButton("Odd Snapshot"));
    expect(push).toHaveBeenCalledWith("/workspace/new/a%2Fb%20c?step=run");
  });

  it("shows no error or banner of its own: a snapshot that is gone is the next page's not-found", () => {
    start();
    fireEvent.click(snapshotButton("Used Snapshot"));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Your session has expired.")).toBeNull();
  });
});
