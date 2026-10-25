import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RunFileBrowser, RunFiles } from "./run-file-browser";
import type { FolderTotal, RunListing } from "@/lib/repository/types";

const LIMIT = 500 * 1024 * 1024;
const fetchMock = vi.fn();

const NC = (name: string, size: number, path = name) => ({
  name,
  path,
  size,
  lastModified: "2026-10-05T16:23:00Z",
});

const ROOT: RunListing = {
  id: "sim-1",
  path: "",
  folders: [
    { name: "daily", path: "daily/" },
    { name: "monthly", path: "monthly/" },
  ],
  files: [NC("wbm_test.MT.csv", 6982), NC("wbm_test.log", 108096)],
  nextCursor: null,
};
const MONTHLY: RunListing = {
  id: "sim-1",
  path: "monthly/",
  folders: [{ name: "runoff", path: "monthly/runoff/" }],
  files: [NC("a.nc", 1024, "monthly/a.nc")],
  nextCursor: null,
};

function total(path: string, bytes: number, over: Partial<FolderTotal> = {}): FolderTotal {
  return { path, files: 3, bytes, limit_bytes: LIMIT, fits: bytes <= LIMIT, complete: true, ...over };
}

type Answer = Response | (() => Response | Promise<Response>);

/** The routes by their address: `/api/jobs/job-1/files?path=…`, `…/files/folder?path=…`. */
function routes(by: Record<string, Answer>) {
  fetchMock.mockImplementation(async (url: string) => {
    const found = by[url];
    if (found === undefined) return new Response("{}", { status: 404 });
    return typeof found === "function" ? found() : found.clone();
  });
}

const json = (body: unknown, status = 200) => Response.json(body, { status });
const refusal = (status: number, code: string, message: string) => json({ detail: { code, message } }, status);

beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("the run's file browser", () => {
  it("lists the output directory with folders first, and says the limit of one ZIP", async () => {
    routes({ "/api/jobs/job-1/files?path=": json(ROOT) });
    render(<RunFileBrowser jobId="job-1" />);
    await screen.findByRole("button", { name: "daily/" });
    expect(screen.getByRole("button", { name: "monthly/" })).toBeTruthy();
    expect(screen.getByText("wbm_test.MT.csv")).toBeTruthy();
    expect(screen.getByText(/one ZIP of up to 500 MB/)).toBeTruthy();
    expect(screen.getByLabelText("Select wbm_test.log")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Download/ })).toBeNull(); // no public URL to give
    expect(screen.queryByText("Download ZIP")).toBeNull(); // nothing ticked yet
  });

  it("opens a folder in place, keeps what it listed, and goes back by the crumbs", async () => {
    routes({ "/api/jobs/job-1/files?path=": json(ROOT), "/api/jobs/job-1/files?path=monthly/": json(MONTHLY) });
    render(<RunFileBrowser jobId="job-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "monthly/" }));
    await screen.findByText("a.nc");
    expect(screen.getByRole("button", { name: "runoff/" })).toBeTruthy();
    expect(screen.getByText("monthly").closest("[aria-current=page]")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Output" }));
    await screen.findByRole("button", { name: "daily/" });
    fireEvent.click(screen.getByRole("button", { name: "monthly/" }));
    await screen.findByText("a.nc");
    // the root and monthly once each, though both were shown twice
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      "/api/jobs/job-1/files?path=",
      "/api/jobs/job-1/files?path=monthly/",
    ]);
  });

  it("totals a ticked file at once and a ticked folder from the gateway, and posts what is ticked", async () => {
    routes({
      "/api/jobs/job-1/files?path=": json(ROOT),
      "/api/jobs/job-1/files/folder?path=daily/": json(total("daily/", 5 * 1024 ** 2)),
    });
    const { container } = render(<RunFileBrowser jobId="job-1" />);
    await screen.findByRole("button", { name: "daily/" });
    fireEvent.click(screen.getByLabelText("Select wbm_test.MT.csv"));
    fireEvent.click(screen.getByLabelText("Select daily/"));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("2 selected · 5.0 MB"));
    const button = screen.getByRole("button", { name: "Download ZIP" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    const form = container.querySelector("form")!;
    expect(form.getAttribute("action")).toBe("/api/jobs/job-1/files/archive");
    expect(form.querySelector<HTMLInputElement>("input[name=folder]")!.value).toBe("");
    expect([...form.querySelectorAll<HTMLInputElement>("input[name=names]")].map((i) => i.value)).toEqual([
      "wbm_test.MT.csv",
      "daily/",
    ]);
  });

  it("marks a selection over 500 MB before anyone clicks, in words that offer no other way", async () => {
    routes({
      "/api/jobs/job-1/files?path=": json(ROOT),
      "/api/jobs/job-1/files/folder?path=daily/": json(total("daily/", 1.3 * 1024 ** 3)),
    });
    render(<RunFileBrowser jobId="job-1" />);
    await screen.findByRole("button", { name: "daily/" });
    fireEvent.click(screen.getByLabelText("Select daily/"));
    await screen.findByText("The selection is 1.3 GB, over the 500 MB limit for a ZIP. Select less.");
    expect((screen.getByRole("button", { name: "Download ZIP" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(/S3|rsync|Globus/)).toBeNull();
  });

  it("says a folder holds too many files to check when the walk was cut off", async () => {
    routes({
      "/api/jobs/job-1/files?path=": json(ROOT),
      "/api/jobs/job-1/files/folder?path=daily/": json(total("daily/", 10, { complete: false, fits: false })),
    });
    render(<RunFileBrowser jobId="job-1" />);
    await screen.findByRole("button", { name: "daily/" });
    fireEvent.click(screen.getByLabelText("Select daily/"));
    await screen.findByText(/too many files to check against the 500 MB limit/);
  });

  it.each([
    [409, "run_not_finished", "This simulation is still running. Its files can be downloaded when it has finished."],
    [410, "output_purged", "Anvil deletes a simulation's files 30 days after it ran, and this one's output is gone."],
    [404, "output_missing", "This simulation's output is not on Anvil (it is not there yet, or it was deleted)."],
  ])("says what the backend says for %i %s, without a Retry", async (status, code, message) => {
    routes({ "/api/jobs/job-1/files?path=": refusal(status, code, message) });
    render(<RunFileBrowser jobId="job-1" />);
    expect((await screen.findByRole("alert")).textContent).toContain(message);
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("offers Retry when Anvil did not answer, and lists when it does", async () => {
    let calls = 0;
    routes({
      "/api/jobs/job-1/files?path=": () =>
        ++calls === 1 ? refusal(503, "anvil_unreachable", "Anvil could not be reached. Try again in a few minutes.") : json(ROOT),
    });
    render(<RunFileBrowser jobId="job-1" />);
    expect((await screen.findByRole("alert")).textContent).toContain("Anvil could not be reached");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("button", { name: "daily/" });
    expect(calls).toBe(2);
  });

  it("says so when the gateway could not be reached at all", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    render(<RunFileBrowser jobId="job-1" />);
    expect((await screen.findByRole("alert")).textContent).toContain("could not be listed right now");
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("says a folder that has nothing in it is empty, and a folder that went missing leads back to the output", async () => {
    routes({
      "/api/jobs/job-1/files?path=": json(ROOT),
      "/api/jobs/job-1/files?path=daily/": json({ ...MONTHLY, path: "daily/", folders: [], files: [] }),
      "/api/jobs/job-1/files?path=monthly/": refusal(404, "path_not_found", "There is nothing at 'monthly/' in this simulation's output."),
    });
    render(<RunFileBrowser jobId="job-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "daily/" }));
    await screen.findByText("This folder is empty.");
    fireEvent.click(screen.getByRole("button", { name: "Output" }));
    fireEvent.click(await screen.findByRole("button", { name: "monthly/" }));
    expect((await screen.findByRole("alert")).textContent).toContain("There is nothing at 'monthly/'");
    fireEvent.click(screen.getByRole("button", { name: "Back to the output" }));
    await screen.findByRole("button", { name: "daily/" });
  });

  it("loads the next page of a big folder by its cursor", async () => {
    routes({
      "/api/jobs/job-1/files?path=": json({ ...ROOT, nextCursor: "2" }),
      "/api/jobs/job-1/files?path=&cursor=2": json({ ...ROOT, folders: [], files: [NC("later.nc", 5)], nextCursor: null }),
    });
    render(<RunFileBrowser jobId="job-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
    await screen.findByText("later.nc");
    expect(screen.getByText("wbm_test.log")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });
});

describe("the run's files on the page", () => {
  it("asks Anvil for nothing until the button is pressed, and hides the browser again", async () => {
    routes({ "/api/jobs/job-1/files?path=": json(ROOT) });
    render(<RunFiles jobId="job-1" />);
    const toggle = screen.getByRole("button", { name: "Browse and download files" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(toggle);
    await screen.findByRole("button", { name: "daily/" });
    expect(screen.getByRole("button", { name: "Hide files" }).getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Hide files" }));
    expect(screen.queryByRole("button", { name: "daily/" })).toBeNull();
  });
});
