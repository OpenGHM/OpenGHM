import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SelectionBar } from "./selection-bar";
import { TreeBrowserTable } from "./tree-browser-table";
import { useTreeSelection } from "./use-tree-selection";
import type { FolderSummary, ListedFile, TreeFile, TreeFolder } from "@/lib/repository/types";

const LIMIT = 500 * 1024 * 1024;
const fetchMock = vi.fn();

const file = (name: string, size: number): TreeFile => ({
  name,
  path: `d/${name}`,
  size,
  lastModified: "2026-10-01T00:00:00Z",
  url: `https://s3.example/openghm/snapshots/abc/d/${name}`,
  previewable: false,
});
const folder = (name: string): TreeFolder => ({ name, path: `d/${name}/` });

const FOLDERS = [folder("deep"), folder("more")];
const FILES = [file("a.nc", 1024), file("b.nc", 2048)];

function summary(bytes: number, over: Partial<FolderSummary> = {}): FolderSummary {
  return { path: "d/deep/", url: "u", files: 4, bytes, limit_bytes: LIMIT, fits: true, complete: true, ...over };
}

/** The summary route answers by the folder asked about. */
function answer(by: Record<string, FolderSummary | number>) {
  fetchMock.mockImplementation(async (url: string) => {
    const path = new URL(url, "http://app.test").searchParams.get("path") ?? "";
    const found = by[path];
    if (typeof found === "number") return new Response("{}", { status: found });
    return found ? Response.json(found) : new Response("{}", { status: 404 });
  });
}

function Harness({ at = "d/" }: { at?: string }) {
  const selection = useTreeSelection("snapshot", "snap-1", at);
  return (
    <>
      <SelectionBar kind="snapshot" id="snap-1" folder={at} files={FILES} selection={selection} />
      <TreeBrowserTable pathname="/x" folder={at} folders={FOLDERS} files={FILES} selection={selection} />
    </>
  );
}

const box = (name: string) => screen.getByRole("checkbox", { name }) as HTMLElement;
const tick = (name: string) => fireEvent.click(box(name));
const download = () => screen.getByRole("button", { name: "Download ZIP" }) as HTMLButtonElement;

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  answer({});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("the checkboxes", () => {
  it("are in front of every row, folders and files, named for the entry, and show nothing selected at first", () => {
    render(<Harness />);
    for (const name of ["Select deep/", "Select more/", "Select a.nc", "Select b.nc", "Select all"]) {
      expect(box(name).getAttribute("aria-checked")).toBe("false");
    }
    expect(screen.queryByRole("button", { name: "Download ZIP" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("the header's ticks every row loaded, dashes when only some are ticked, and clears", () => {
    render(<Harness />);
    tick("Select a.nc");
    expect(box("Select all").getAttribute("aria-checked")).toBe("mixed");
    tick("Select all");
    expect(box("Select all").getAttribute("aria-checked")).toBe("true");
    for (const name of ["Select deep/", "Select more/", "Select a.nc", "Select b.nc"]) {
      expect(box(name).getAttribute("aria-checked")).toBe("true");
    }
    tick("Select all");
    expect(box("Select all").getAttribute("aria-checked")).toBe("false");
    expect(box("Select a.nc").getAttribute("aria-checked")).toBe("false");
  });

  it("the header's goes through a partly ticked state to all, not to none", () => {
    render(<Harness />);
    tick("Select b.nc");
    tick("Select all");
    expect(box("Select deep/").getAttribute("aria-checked")).toBe("true");
  });
});

describe("the selection bar", () => {
  it("counts files and adds their listed sizes at once, without asking about any folder", () => {
    render(<Harness />);
    tick("Select a.nc");
    tick("Select b.nc");
    expect(screen.getByRole("status").textContent).toBe("2 selected · 3.0 KB");
    expect(download().disabled).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks a ticked folder's size, says it is checking meanwhile, and adds it when it comes", async () => {
    let finish: (r: Response) => void = () => {};
    fetchMock.mockReturnValue(new Promise<Response>((r) => (finish = r)));
    render(<Harness />);
    tick("Select a.nc");
    tick("Select deep/");
    expect(fetchMock).toHaveBeenCalledWith("/api/repository/datasets/snap-1/files/folder?path=d/deep/");
    expect(screen.getByRole("status").textContent).toBe("2 selected · checking size…");
    expect(download().disabled).toBe(true);
    await act(async () => finish(Response.json(summary(5 * 1024 ** 2))));
    expect(screen.getByRole("status").textContent).toBe("2 selected · 5.0 MB");
    expect(download().disabled).toBe(false);
  });

  it("asks about a folder once for as long as the view is open, even when it is unticked and ticked again", async () => {
    answer({ "d/deep/": summary(10) });
    render(<Harness />);
    tick("Select deep/");
    await screen.findByText(/10 B/);
    tick("Select deep/");
    tick("Select deep/");
    expect(screen.getByRole("status").textContent).toBe("1 selected · 10 B");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("is over the limit at once for a big folder: the button is off and the reason is written there", async () => {
    answer({ "d/deep/": summary(3 * 1024 ** 3, { fits: false }) });
    render(<Harness />);
    tick("Select a.nc");
    tick("Select deep/");
    expect(
      await screen.findByText(
        "The selection is 3.0 GB, over the 500 MB limit for a ZIP. Select less, or use the S3 command below."
      )
    ).toBeTruthy();
    expect(download().disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toBe("2 selected · 3.0 GB");
  });

  it("over the limit, shows the S3 command for just what is ticked, with a copy button", async () => {
    answer({ "d/deep/": summary(3 * 1024 ** 3, { fits: false }) });
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    render(<Harness />);
    tick("Select a.nc");
    tick("Select deep/");
    const command =
      'aws s3 sync --no-sign-request --endpoint-url https://s3.example s3://openghm/snapshots/abc/d/ ./d --exclude "*" --include "a.nc" --include "deep/*"';
    expect(await screen.findByText(command)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy S3 command" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(command);
  });

  it("shows no S3 command while the selection fits, or while it is only being checked", async () => {
    answer({ "d/deep/": summary(10) });
    render(<Harness />);
    tick("Select deep/");
    expect(screen.queryByRole("button", { name: "Copy S3 command" })).toBeNull();
    await screen.findByText(/10 B/);
    expect(screen.queryByRole("button", { name: "Copy S3 command" })).toBeNull();
    expect(screen.queryByText(/S3 command below/)).toBeNull();
  });

  it("keeps the old wording and shows no command when the viewed folder's URL is not known", async () => {
    answer({ "d/deep/": summary(3 * 1024 ** 3, { fits: false }) });
    function Bare() {
      const selection = useTreeSelection("snapshot", "snap-1", "d/");
      return (
        <>
          <SelectionBar kind="snapshot" id="snap-1" folder="d/" files={[]} selection={selection} />
          <TreeBrowserTable pathname="/x" folder="d/" folders={FOLDERS} files={[]} selection={selection} />
        </>
      );
    }
    render(<Bare />);
    tick("Select deep/");
    await screen.findByText("The selection is 3.0 GB, over the 500 MB limit for a ZIP. Select less, or use an S3 tool.");
    expect(screen.queryByRole("button", { name: "Copy S3 command" })).toBeNull();
  });

  it("adds up to the limit across folders and files: each fits, the two together do not", async () => {
    answer({ "d/deep/": summary(300 * 1024 ** 2), "d/more/": summary(300 * 1024 ** 2) });
    render(<Harness />);
    tick("Select deep/");
    await waitFor(() => expect(download().disabled).toBe(false));
    tick("Select more/");
    await screen.findByText(/over the 500 MB limit for a ZIP/);
    expect(download().disabled).toBe(true);
    tick("Select more/");
    expect(download().disabled).toBe(false);
  });

  it("counts a folder the backend could only list in part as over", async () => {
    answer({ "d/deep/": summary(1, { complete: false, fits: false }) });
    render(<Harness />);
    tick("Select deep/");
    await screen.findByText(/holds too many files to check against the 500 MB limit/);
    expect(download().disabled).toBe(true);
  });

  it("says calmly which folder could not be sized and tries again on request", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    render(<Harness />);
    tick("Select deep/");
    expect(await screen.findByText(/The size of deep\/ could not be checked\./)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(download().disabled).toBe(true);
    answer({ "d/deep/": summary(2048) });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText(/2\.0 KB/);
    expect(download().disabled).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("treats a backend error status as a failed check", async () => {
    answer({ "d/deep/": 503 });
    render(<Harness />);
    tick("Select deep/");
    expect(await screen.findByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("Clear unticks everything and takes the bar away", () => {
    render(<Harness />);
    tick("Select a.nc");
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(box("Select a.nc").getAttribute("aria-checked")).toBe("false");
  });

  it("starts empty in another folder, and again when the first is opened once more", () => {
    const { rerender } = render(<Harness at="d/" />);
    tick("Select a.nc");
    rerender(<Harness at="d/deep/" />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(box("Select a.nc").getAttribute("aria-checked")).toBe("false");
    rerender(<Harness at="d/" />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("the download", () => {
  it("is a hidden form POSTed to the gateway with the folder and each name, aimed at a hidden frame", () => {
    render(<Harness />);
    tick("Select deep/");
    tick("Select b.nc");
    tick("Select a.nc");
    const form = download().closest("form") as HTMLFormElement;
    expect(form.getAttribute("method")?.toUpperCase()).toBe("POST");
    expect(form.getAttribute("action")).toBe("/api/repository/datasets/snap-1/files/archive");
    const data = new FormData(form);
    expect(data.get("folder")).toBe("d/");
    expect(data.getAll("names")).toEqual(["deep/", "b.nc", "a.nc"]); // in the order ticked
    const frame = document.querySelector(`iframe[name="${form.getAttribute("target")}"]`);
    expect(frame).toBeTruthy();
    expect(frame?.className).toContain("hidden");
  });

  it("is not fetched: the page never calls the archive route from script", () => {
    answer({});
    render(<Harness />);
    tick("Select a.nc");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/archive"))).toBe(false);
  });

  it("shows what the frame loaded when it is a refusal, and forgets it on the next submit", () => {
    render(<Harness />);
    tick("Select a.nc");
    const form = download().closest("form") as HTMLFormElement;
    const frame = document.querySelector(`iframe[name="${form.getAttribute("target")}"]`) as HTMLIFrameElement;
    frame.contentDocument!.body.textContent = JSON.stringify({
      detail: { code: "archive_busy", message: "Other downloads are being prepared. Try again in a minute." },
    });
    fireEvent.load(frame);
    expect(screen.getByText("Other downloads are being prepared. Try again in a minute.")).toBeTruthy();
    fireEvent.submit(form);
    expect(screen.queryByText(/Other downloads/)).toBeNull();
  });

  it("shows nothing for a frame that loaded nothing", () => {
    render(<Harness />);
    tick("Select a.nc");
    const form = download().closest("form") as HTMLFormElement;
    const frame = document.querySelector(`iframe[name="${form.getAttribute("target")}"]`) as HTMLIFrameElement;
    fireEvent.load(frame);
    expect(within(form.parentElement as HTMLElement).queryByText(/could not be prepared/)).toBeNull();
  });
});

describe("for a run's output on Anvil scratch (ADR 0040)", () => {
  const runFile = (name: string, size: number): ListedFile => ({
    name,
    path: `daily/${name}`,
    size,
    lastModified: "2026-10-01T00:00:00Z",
  });
  const RUN_FILES = [runFile("a.nc", 1024), runFile("b.nc", 2048)];

  function RunHarness() {
    const selection = useTreeSelection("run", "job-1", "daily/");
    return (
      <>
        <SelectionBar kind="run" id="job-1" folder="daily/" files={RUN_FILES} selection={selection} />
        <TreeBrowserTable pathname="" folder="daily/" folders={FOLDERS} files={RUN_FILES} selection={selection} />
      </>
    );
  }

  it("asks the job's route for a folder's size and posts the ZIP form to the job's archive route", async () => {
    answer({ "daily/deep/": summary(5 * 1024 ** 2) });
    const { container } = render(<RunHarness />);
    tick("Select a.nc");
    tick("Select deep/");
    expect(fetchMock).toHaveBeenCalledWith("/api/jobs/job-1/files/folder?path=daily/deep/");
    await waitFor(() => expect(download().disabled).toBe(false));
    const form = container.querySelector("form")!;
    expect(form.getAttribute("action")).toBe("/api/jobs/job-1/files/archive");
    expect(form.getAttribute("method")?.toLowerCase()).toBe("post");
    expect(form.querySelector<HTMLInputElement>("input[name=folder]")!.value).toBe("daily/");
    expect([...form.querySelectorAll<HTMLInputElement>("input[name=names]")].map((i) => i.value)).toEqual(["a.nc", "deep/"]);
  });

  it("over the limit says so and says nothing of S3, which does not hold a run's output", async () => {
    answer({ "daily/deep/": summary(3 * 1024 ** 3) });
    render(<RunHarness />);
    tick("Select deep/");
    await screen.findByText("The selection is 3.0 GB, over the 500 MB limit for a ZIP. Select less.");
    expect(download().disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Copy S3 command" })).toBeNull();
    expect(screen.queryByText(/S3/)).toBeNull();
  });

  it("gives a file with no public URL no link actions, and still lets it be ticked", () => {
    render(<RunHarness />);
    expect(screen.queryByRole("link", { name: /Download/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Copy URL/ })).toBeNull();
    tick("Select b.nc");
    expect(screen.getByRole("status").textContent).toBe("1 selected · 2.0 KB");
  });
});
