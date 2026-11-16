import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

let search = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => "/repository/x",
}));
// Leaflet is not under test: a stub that calls onPick like a click on the map.
vi.mock("./output-map-dynamic", () => ({
  OutputMap: ({ image, onPick }: { image: { url: string } | null; onPick: (p: { lon: number; lat: number }) => void }) => (
    <div>
      <span data-testid="image">{image ? "image" : "none"}</span>
      <button onClick={() => onPick({ lon: 1.25, lat: 2.5 })}>pick</button>
    </div>
  ),
}));

import { OutputCard } from "./output-card";

const inventory = {
  grid: { bounds: { west: -10, south: 30, east: 10, north: 50 }, cellSize: 0.5 },
  resolutions: {
    yearly: { years: [2000, 2001], first: "2000-07-01", last: "2001-07-01" },
    monthly: { years: [2000, 2001], first: "2000-01-16", last: "2001-12-16" },
  },
  variables: [
    { name: "runoff", longName: "Runoff", units: "mm", resolutions: { yearly: { years: [2000, 2001] }, monthly: { years: [2000, 2001] } } },
  ],
  ramps: ["DarkBlue", "Rainbow"],
};
const legend = { ramp: "Rainbow", rampUsed: "Rainbow", min: 0, max: 10, log: false, auto: false, colors: ["#000000", "#ffffff"] };
const times = Array.from({ length: 24 }, (_, i) => `${2000 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-16`);

let calls: URL[] = [];
function stub(overrides: Record<string, () => Response> = {}) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = new URL(input, "http://app.test");
      calls.push(url);
      const hit = overrides[url.pathname.replace(/.*\/output/, "") || "/"];
      if (hit) return hit();
      if (url.pathname.endsWith("/map")) {
        return Response.json({ bbox: inventory.grid.bounds, units: "mm", time: url.searchParams.get("start"), legend, base64: "AA==" });
      }
      if (url.pathname.endsWith("/series")) {
        return Response.json({
          point: { lon: 1.25, lat: 2.5, cellLon: 1.25, cellLat: 2.5 },
          units: "mm",
          times,
          values: times.map((_, i) => i),
        });
      }
      return Response.json(inventory);
    })
  );
}
const lastMap = () => calls.filter((u) => u.pathname.endsWith("/map")).at(-1)!;

beforeEach(() => {
  search = "";
  window.history.replaceState(null, "", "/repository/x");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const source = { kind: "dataset" as const, id: "a".repeat(64) };

describe("the Output card", () => {
  it("opens on the first variable's latest yearly step, and keeps that in the URL", async () => {
    stub();
    render(<OutputCard source={source} />);
    await waitFor(() => expect(screen.getByTestId("image").textContent).toBe("image"));
    expect(Object.fromEntries(lastMap().searchParams)).toEqual({ variable: "runoff", resolution: "yearly", start: "2001", image: "webp", projection: "mercator" });
    expect(window.location.search).toBe("?ovar=runoff&ores=yearly&odate=2001");
    expect(screen.getByTestId("output-legend")).toBeTruthy();
    // Only the resolutions the variable has are tabs.
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Yearly", "Monthly"]);
  });

  it("restores a view from the URL, and steps with previous and next", async () => {
    search = "ovar=runoff&ores=monthly&odate=2000-03&oramp=DarkBlue&omin=1&omax=9&olog=1";
    stub();
    render(<OutputCard source={source} />);
    await waitFor(() => expect(calls.some((u) => u.pathname.endsWith("/map"))).toBe(true));
    expect(Object.fromEntries(lastMap().searchParams)).toEqual({
      variable: "runoff",
      resolution: "monthly",
      start: "2000-03",
      image: "webp",
      projection: "mercator",
      ramp: "DarkBlue",
      min: "1",
      max: "9",
      log: "true",
    });
    fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    await waitFor(() => expect(lastMap().searchParams.get("start")).toBe("2000-04"));
  });

  it("redraws with the ramp chosen, and Reset goes back to the run's legend", async () => {
    stub();
    render(<OutputCard source={source} />);
    await waitFor(() => expect(screen.getByTestId("image").textContent).toBe("image"));
    fireEvent.change(screen.getByLabelText("Colour ramp"), { target: { value: "DarkBlue" } });
    await waitFor(() => expect(lastMap().searchParams.get("ramp")).toBe("DarkBlue"));
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(lastMap().searchParams.has("ramp")).toBe(false));
  });

  it("does not ask for a map whose range is upside down", async () => {
    stub();
    render(<OutputCard source={source} />);
    await waitFor(() => expect(screen.getByTestId("image").textContent).toBe("image"));
    const before = calls.length;
    const min = screen.getByLabelText("Minimum");
    fireEvent.change(min, { target: { value: "5" } });
    fireEvent.blur(min);
    const max = screen.getByLabelText("Maximum");
    fireEvent.change(max, { target: { value: "2" } });
    fireEvent.blur(max);
    await screen.findByText("The minimum must be below the maximum.");
    expect(calls.filter((u) => u.searchParams.get("max") === "2")).toHaveLength(0);
    expect(calls.length).toBe(before + 1); // only the min=5 map
  });

  it("draws the series of a clicked cell and keeps Decembers with offset 11, step 12", async () => {
    search = "ovar=runoff&ores=monthly&odate=2000-03";
    stub();
    render(<OutputCard source={source} />);
    await waitFor(() => expect(screen.getByTestId("image").textContent).toBe("image"));
    fireEvent.click(screen.getByText("pick"));
    await screen.findByText(/24 of 24 points/);
    const asked = calls.find((u) => u.pathname.endsWith("/series"))!;
    expect(Object.fromEntries(asked.searchParams)).toEqual({
      variable: "runoff",
      resolution: "monthly",
      point: "1.25,2.5",
      display: "true",
    });
    const offset = screen.getByLabelText(/Offset/);
    fireEvent.change(offset, { target: { value: "11" } });
    fireEvent.blur(offset);
    const step = screen.getByLabelText(/Step: /);
    fireEvent.change(step, { target: { value: "12" } });
    fireEvent.blur(step);
    await screen.findByText(/2 of 24 points/);
    expect(window.location.search).toContain("opoint=1.25%2C2.5");
    expect(window.location.search).toContain("ooff=11");
    expect(window.location.search).toContain("ostep=12");
  });

  it("shows the API's message when the series is refused", async () => {
    stub({
      "/series": () => Response.json({ detail: { code: "output_request_refused", message: "a daily series may span at most a year" } }, { status: 422 }),
    });
    render(<OutputCard source={source} />);
    await waitFor(() => expect(screen.getByTestId("image").textContent).toBe("image"));
    fireEvent.click(screen.getByText("pick"));
    await screen.findByText(/A daily series may span at most a year/);
  });

  it("says a purged run's output is gone, without an error", async () => {
    stub({ "/": () => Response.json({ detail: { code: "output_purged", message: "gone" } }, { status: 410 }) });
    render(<OutputCard source={{ kind: "job", id: "j1" }} />);
    await screen.findByText(/output is gone/);
    expect(screen.queryByText("Try again")).toBeNull();
    expect(calls[0].pathname).toBe("/api/jobs/j1/output");
  });

  it("says when a run has no output, and offers a retry for a failure", async () => {
    stub({ "/": () => Response.json({ detail: { code: "output_missing", message: "no" } }, { status: 404 }) });
    render(<OutputCard source={{ kind: "job", id: "j1" }} />);
    await screen.findByText("This has no output to show yet.");
    cleanup();
    stub({ "/": () => Response.json({ detail: { code: "anvil_unreachable", message: "x" } }, { status: 503 }) });
    render(<OutputCard source={{ kind: "job", id: "j1" }} />);
    await screen.findByText(/Anvil could not be reached/);
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("offers a NetCDF download with its expected size", async () => {
    stub();
    render(<OutputCard source={source} />);
    await waitFor(() => expect(screen.getByTestId("image").textContent).toBe("image"));
    expect(screen.getByRole("button", { name: "Download NetCDF" })).toBeTruthy();
    expect(screen.getByText(/runoff, yearly, whole grid · 1 time step · up to/)).toBeTruthy();
  });
});
