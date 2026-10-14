import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
const { fetchTreeListing } = vi.hoisted(() => ({ fetchTreeListing: vi.fn() }));
vi.mock("@/lib/repository/actions", () => ({ fetchTreeListing, fetchTreePreview: vi.fn() }));

import { OutputDialog, type OutputTab } from "./output-dialog";
import type { OutputInventory } from "@/lib/repository/output";
import type { OutputFolder } from "@/lib/repository/types";

const INVENTORY: OutputInventory = {
  grid: { bounds: { west: -180, south: -60, east: 180, north: 85 }, cellSize: 1 / 12, crs: "EPSG:4326" },
  resolutions: {
    daily: { years: [2000, 2001], first: "2000-01-01", last: "2001-12-31" },
    yearly: { years: [2000, 2001], first: "2000-07-01", last: "2001-07-01" },
  },
  variables: [
    { name: "runoff", longName: "Runoff", units: "mm/day", resolutions: { daily: { years: [2000, 2001] }, yearly: { years: [2000, 2001] } } },
    { name: "cellArea", longName: null, units: null, resolutions: { yearly: { years: [2000, 2001] } } },
  ],
};
const OUTPUT: OutputFolder[] = [
  { run: "G", name: "daily", path: "wbm_output/G/daily/", files: 2, bytes: 3 * 1024 ** 3 },
  { run: "G", name: "yearly", path: "wbm_output/G/yearly/", files: 4, bytes: 1024 ** 2 },
  { run: "G", name: "cell_area", path: "wbm_output/G/cell_area/", files: 1, bytes: 1024 },
];

const fetchMock = vi.fn();
let snapshot = 0;
const id = () => `${String(snapshot).padStart(2, "0")}${"a".repeat(62)}`;

beforeEach(() => {
  // A fresh id per test: the dialog keeps an inventory per snapshot for the page's life.
  snapshot += 1;
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (url: string) => {
    if (url.endsWith("/output")) return Response.json(INVENTORY);
    return new Response("netcdf!", { headers: { "content-length": "7" } });
  });
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

function open(tab: OutputTab = "subset") {
  const onTabChange = vi.fn();
  render(
    <OutputDialog
      snapshotId={id()}
      treeUrl="https://s3.example/openghm/snapshots/abc/"
      output={OUTPUT}
      variables={[{ name: "cellArea", fullName: "Cell area" }]}
      open
      onOpenChange={() => {}}
      tab={tab}
      onTabChange={onTabChange}
    />
  );
  return onTabChange;
}

describe("the subset tab", () => {
  it("lists the inventory's variables, searchable, with the metadata's name for one the inventory leaves unnamed", async () => {
    open();
    const list = await screen.findByRole("radiogroup", { name: "Variable" });
    expect(fetchMock).toHaveBeenCalledWith(`/api/repository/datasets/${id()}/output`);
    expect(screen.getByText("2 in this run")).toBeTruthy();
    expect(within(list).getByRole("radio", { name: "runoff, Runoff, mm/day", checked: true })).toBeTruthy();
    expect(within(list).getByRole("radio", { name: "cellArea, Cell area" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search variables"), { target: { value: "cell" } });
    expect(within(list).getAllByRole("radio")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Search variables"), { target: { value: "zzz" } });
    expect(within(list).getByText("No variable matches.")).toBeTruthy();
  });

  it("offers the time steps a variable has, and months for daily data", async () => {
    open();
    const steps = await screen.findByRole("radiogroup", { name: "Time step" });
    expect(within(steps).getByRole("radio", { name: /Yearly/, checked: true })).toBeTruthy();
    expect((within(steps).getByRole("radio", { name: /Monthly/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("group", { name: "Months" })).toBeNull();
    expect(screen.getAllByText("2000 – 2001 · 2 years").length).toBeGreaterThan(0);

    fireEvent.click(within(steps).getByRole("radio", { name: /Daily/ }));
    expect(screen.getByRole("group", { name: "Months" })).toBeTruthy();
    expect(screen.getAllByText("Jan 2000 · 31 days").length).toBeGreaterThan(0);
    expect(screen.getByText("runoff_daily_2000-01.nc")).toBeTruthy();

    // A variable without daily output falls back to a step it has.
    fireEvent.click(screen.getByRole("radio", { name: /cellArea/ }));
    expect(within(steps).getByRole("radio", { name: /Yearly/, checked: true })).toBeTruthy();
  });

  it("picks a period in two clicks and shows the whole of it again with All years", async () => {
    open();
    const years = await screen.findByRole("group", { name: "Period" });
    fireEvent.click(within(years).getByRole("button", { name: "2001" }));
    expect(screen.getByText(/Now click the last year/)).toBeTruthy();
    fireEvent.click(within(years).getByRole("button", { name: "2001" }));
    expect(screen.getAllByText("2001 · 1 year").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "All years" }));
    expect(screen.getAllByText("2000 – 2001 · 2 years").length).toBeGreaterThan(0);
  });

  it("downloads a box's subset under its own name, and has the same request as a command", async () => {
    open();
    await screen.findByRole("radiogroup", { name: "Variable" });
    fireEvent.click(screen.getByRole("radio", { name: "A box" }));
    fireEvent.change(screen.getByLabelText("west"), { target: { value: "-112" } });
    fireEvent.change(screen.getByLabelText("east"), { target: { value: "-104" } });
    fireEvent.change(screen.getByLabelText("south"), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText("north"), { target: { value: "46" } });
    expect(screen.getByText("40° N – 46° N, 112° W – 104° W")).toBeTruthy();
    // The box is drawn on the base map, one unit per degree: x = longitude + 180, y = 90 - latitude.
    expect(screen.getByTestId("grid-preview-land")).toBeTruthy();
    const rect = screen.getByTestId("grid-preview-box");
    expect(["x", "y", "width", "height"].map((a) => rect.getAttribute(a))).toEqual(["68", "44", "8", "6"]);
    // 2 years x 72 x 96 cells x 4 bytes
    expect(screen.getByText("54.0 KB")).toBeTruthy();
    expect(screen.getByText("Same file from a script").textContent).toContain("Coming soon");
    const command = screen.getByText(/openghm output subset/).textContent;
    expect(command).toContain("--bbox -112,40,-104,46");
    expect(command).toContain("--out runoff_yearly_2000_2001_box.nc");

    fireEvent.click(screen.getByRole("button", { name: "Download NetCDF" }));
    expect(await screen.findByRole("button", { name: "Saved ✓" })).toBeTruthy();
    const url = new URL(fetchMock.mock.calls[1][0], "http://x");
    expect(url.pathname).toBe(`/api/repository/datasets/${id()}/output/subset`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      variable: "runoff",
      resolution: "yearly",
      start: "2000",
      end: "2001",
      bbox: "-112,40,-104,46",
    });
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it("will not download a box that is not one, and warns of a file too large for one download", async () => {
    open();
    await screen.findByRole("radiogroup", { name: "Variable" });
    fireEvent.click(screen.getByRole("radio", { name: "A box" }));
    fireEvent.change(screen.getByLabelText("west"), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText("east"), { target: { value: "10" } });
    expect(screen.getByRole("alert").textContent).toMatch(/East must be east of West/);
    expect((screen.getByRole("button", { name: "Fix the box to download" }) as HTMLButtonElement).disabled).toBe(true);

    // The whole grid, daily, a year: 365 x 1740 x 4320 x 4 bytes, far over 1 GiB.
    fireEvent.click(screen.getByRole("radio", { name: "The whole grid" }));
    fireEvent.click(screen.getByRole("radio", { name: /Daily/ }));
    const months = screen.getByRole("group", { name: "Months" });
    fireEvent.click(within(months).getByRole("button", { name: "Jan" }));
    fireEvent.click(within(months).getByRole("button", { name: "Dec" }));
    expect(screen.getByText(/Over 1 GB before compression/)).toBeTruthy();
  });

  it("shows a refusal in the toolkit's words", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith("/output")
        ? Response.json(INVENTORY)
        : Response.json(
            { detail: { code: "output_request_refused", message: "this request reads 910 million cells. Ask for less." } },
            { status: 422 }
          )
    );
    open();
    await screen.findByRole("radiogroup", { name: "Variable" });
    fireEvent.click(screen.getByRole("button", { name: "Download NetCDF" }));
    expect((await screen.findByRole("alert")).textContent).toBe("This request reads 910 million cells. Ask for less.");
  });

  it("says when the output cannot be read, and tries again", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ detail: { code: "anvil_unreachable", message: "Anvil could not be reached." } }, { status: 503 })
    );
    open();
    expect((await screen.findByRole("alert")).textContent).toBe("Anvil could not be reached.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByRole("radiogroup", { name: "Variable" })).toBeTruthy());
  });
});

describe("the output files tab", () => {
  it("lists the time step folders with their share, links each into the files page, and syncs the folder", async () => {
    open("files");
    expect(fetchMock).not.toHaveBeenCalled();
    const rows = within(screen.getByRole("list", { name: "Output by time step" })).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining("Yearly"), expect.stringContaining("Daily")]);
    expect(rows[1].textContent).toContain("Large");
    expect(screen.getByText("All 7 files, 3.0 GB.")).toBeTruthy();
    const sync =
      "aws s3 sync --no-sign-request --endpoint-url https://s3.example s3://openghm/snapshots/abc/wbm_output/G/ ./wbm_output";
    expect(screen.getByText(sync)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy S3 command" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(sync);
  });
});

describe("browsing the output inside the dialog", () => {
  it("opens a time step folder in place, walks into a folder and back by the crumbs, and returns to the overview", async () => {
    fetchTreeListing.mockImplementation(async (_kind: string, _id: string, path: string) => ({
      ok: true,
      data:
        path === "wbm_output/G/yearly/"
          ? { id: "x", path, folders: [{ name: "runoff", path: "wbm_output/G/yearly/runoff/" }], files: [], nextCursor: null }
          : {
              id: "x",
              path,
              folders: [],
              files: [
                {
                  name: "wbm_2000.nc",
                  path: `${path}wbm_2000.nc`,
                  size: 1024,
                  lastModified: "2026-09-26T00:00:00Z",
                  url: "https://s3.example/wbm_2000.nc",
                  previewable: false,
                },
              ],
              nextCursor: null,
            },
    }));
    open("files");
    fireEvent.click(screen.getByRole("button", { name: "Browse Yearly output" }));
    // No navigation: the folder is listed in the dialog.
    fireEvent.click(await screen.findByRole("button", { name: "runoff/" }));
    expect(await screen.findByText("wbm_2000.nc")).toBeTruthy();
    expect(fetchTreeListing).toHaveBeenLastCalledWith("snapshot", id(), "wbm_output/G/yearly/runoff/");
    expect(screen.getByRole("link", { name: "Download wbm_2000.nc" }).getAttribute("href")).toBe("https://s3.example/wbm_2000.nc");
    const crumbs = within(screen.getByRole("navigation", { name: "Output folders" }));
    expect(crumbs.getByText("runoff").getAttribute("aria-current")).toBe("page");
    fireEvent.click(crumbs.getByRole("button", { name: "yearly" }));
    expect(await screen.findByRole("button", { name: "runoff/" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open in files page/ }).getAttribute("target")).toBe("_blank");
    fireEvent.click(screen.getByRole("button", { name: "← Output files" }));
    expect(screen.getByRole("list", { name: "Output by time step" })).toBeTruthy();
    fetchTreeListing.mockReset();
  });

  it("keeps each tab as it was across a switch", async () => {
    fetchTreeListing.mockResolvedValue({
      ok: true,
      data: { id: "x", path: "wbm_output/G/", folders: [], files: [], nextCursor: null },
    });
    let tab: OutputTab = "files";
    const { rerender } = render(
      <OutputDialog snapshotId={id()} treeUrl="https://s3.example/openghm/snapshots/abc/" output={OUTPUT} variables={[]}
        open onOpenChange={() => {}} tab={tab} onTabChange={(t) => (tab = t)} />
    );
    fireEvent.click(screen.getByRole("button", { name: "All output files →" }));
    expect(await screen.findByText("This folder is empty.")).toBeTruthy();
    // To the subset tab and back: the files tab is still in its folder.
    rerender(
      <OutputDialog snapshotId={id()} treeUrl="https://s3.example/openghm/snapshots/abc/" output={OUTPUT} variables={[]}
        open onOpenChange={() => {}} tab="subset" onTabChange={() => {}} />
    );
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Output files" }));
    rerender(
      <OutputDialog snapshotId={id()} treeUrl="https://s3.example/openghm/snapshots/abc/" output={OUTPUT} variables={[]}
        open onOpenChange={() => {}} tab="files" onTabChange={() => {}} />
    );
    expect(screen.getByText("This folder is empty.")).toBeTruthy();
    fetchTreeListing.mockReset();
  });
});
