import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FakeNavigation } from "@/lib/workspace/fake-navigation";

const PATHNAME = "/repository/snap-1/files";

// The page reads `?path=` and `?file=` from the URL and follows `history.pushState`
// as Next's router does: here, through the fake navigation's `currententrychange`.
vi.mock("next/navigation", async () => {
  const React = await import("react");
  const subscribe = (cb: () => void) => {
    const nav = (window as unknown as { navigation?: EventTarget }).navigation;
    nav?.addEventListener("currententrychange", cb);
    return () => nav?.removeEventListener("currententrychange", cb);
  };
  return {
    usePathname: () => "/repository/snap-1/files",
    useSearchParams: () => {
      const search = React.useSyncExternalStore(
        subscribe,
        () => window.location.search,
        () => ""
      );
      return React.useMemo(() => new URLSearchParams(search), [search]);
    },
  };
});
vi.mock("@/lib/repository/actions", () => ({ fetchTreeListing: vi.fn(), fetchTreePreview: vi.fn() }));

import { fetchTreeListing, fetchTreePreview } from "@/lib/repository/actions";
import { TreeBrowser } from "./tree-browser";
import type { TreeFile, TreeFolder, TreeListing, TreePreview, TreeResult } from "@/lib/repository/types";

const BASE = "https://anvil.example/bucket/snapshots/snap-1/";

function file(path: string, over: Partial<TreeFile> = {}): TreeFile {
  return {
    name: path.split("/").pop() ?? path,
    path,
    size: 2048,
    lastModified: "2026-09-30T12:00:00Z",
    url: `${BASE}${path}`,
    previewable: true,
    ...over,
  };
}

function folder(path: string): TreeFolder {
  return { name: path.replace(/\/$/, "").split("/").pop() ?? path, path };
}

function listing(path: string, over: Partial<TreeListing> = {}): TreeResult<TreeListing> {
  return { ok: true, data: { id: "snap-1", path, folders: [], files: [], nextCursor: null, ...over } };
}

function preview(over: Partial<TreePreview> = {}): TreeResult<TreePreview> {
  return {
    ok: true,
    data: { path: "x", size: 10, kind: "text", text: "hello", truncated: false, ...over },
  };
}

const ROOT = listing("", {
  folders: [folder("wbm_init/"), folder("wbm_output/")],
  files: [file("metadata.json"), file("SHA256SUMS"), file("grid.nc", { previewable: false })],
});

let nav: FakeNavigation;

/** Answers each listing by its folder, in the order its pages are given. */
function serve(pages: Record<string, TreeResult<TreeListing>[]>) {
  const next: Record<string, number> = {};
  vi.mocked(fetchTreeListing).mockImplementation(async (_kind, _id, path) => {
    const list = pages[path] ?? [{ ok: false, code: "path_not_found" } as const];
    const i = next[path] ?? 0;
    next[path] = i + 1;
    return list[Math.min(i, list.length - 1)];
  });
}

function setup(url = PATHNAME) {
  nav = new FakeNavigation([url]);
  return render(<TreeBrowser kind="snapshot" id="snap-1" name="Test snapshot" />);
}

const fetchMock = vi.fn();

beforeEach(() => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  // The size of a folder, for its ZIP: small unless a test says otherwise.
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async () =>
    Response.json({ path: "x", url: `${BASE}x/`, files: 3, bytes: 3072, limit_bytes: 500 * 1024 ** 2, fits: true, complete: true })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  nav.uninstall();
  vi.mocked(fetchTreeListing).mockReset();
  vi.mocked(fetchTreePreview).mockReset();
});

function crumbs() {
  return within(screen.getByRole("navigation", { name: "Folders of Test snapshot" }));
}

describe("TreeBrowser listing", () => {
  it("shows a loading skeleton, then the root: folders first, then files with size and date", async () => {
    serve({ "": [ROOT] });
    setup();
    expect(screen.getByRole("status", { name: "Loading folder" })).toBeTruthy();
    await screen.findByText("metadata.json");
    expect(fetchTreeListing).toHaveBeenCalledWith("snapshot", "snap-1", "");
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByRole("cell")[1].textContent)).toEqual([
      "wbm_init/",
      "wbm_output/",
      "metadata.json",
      "SHA256SUMS",
      "grid.nc",
    ]);
    const cells = within(rows[2]).getAllByRole("cell");
    // After the row's checkbox and its name.
    expect(cells[2].textContent).toBe("2.0 KB");
    expect(cells[3].textContent).toBe("30 Sep 2026");
  });

  it("gives each file a download link to its public URL and a copy-URL button", async () => {
    serve({ "": [ROOT] });
    setup();
    await screen.findByText("metadata.json");
    const link = screen.getByRole("link", { name: "Download metadata.json" });
    expect(link.getAttribute("href")).toBe(`${BASE}metadata.json`);
    fireEvent.click(screen.getByRole("button", { name: "Copy URL of metadata.json" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`${BASE}metadata.json`);
    await screen.findByTitle("Copied");
  });

  it("walks into a folder on a click: the URL gets ?path=, the breadcrumbs follow, and a click on a crumb walks back", async () => {
    serve({
      "": [ROOT],
      "wbm_output/": [listing("wbm_output/", { folders: [folder("wbm_output/run1/")] })],
      "wbm_output/run1/": [listing("wbm_output/run1/", { files: [file("wbm_output/run1/a.txt")] })],
    });
    setup();
    fireEvent.click(await screen.findByRole("link", { name: "wbm_output/" }));
    await screen.findByRole("link", { name: "run1/" });
    expect(nav.currentEntry.url).toContain("?path=wbm_output/");
    expect(fetchTreeListing).toHaveBeenLastCalledWith("snapshot", "snap-1", "wbm_output/");

    fireEvent.click(screen.getByRole("link", { name: "run1/" }));
    await screen.findByText("a.txt");
    expect(crumbs().getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Root",
      "wbm_output",
      "run1",
    ]);
    expect(crumbs().getByText("run1").getAttribute("aria-current")).toBe("page");

    fireEvent.click(crumbs().getByRole("link", { name: "wbm_output" }));
    await screen.findByRole("link", { name: "run1/" });
    fireEvent.click(crumbs().getByRole("link", { name: "Root" }));
    await screen.findByText("metadata.json");
    expect(nav.currentEntry.url).toBe(`${window.location.origin}${PATHNAME}`);
  });

  it("opens straight at ?path= when the link names a folder, and Back returns to the one before", async () => {
    serve({
      "": [ROOT],
      "wbm_output/": [listing("wbm_output/", { files: [file("wbm_output/a.txt")] })],
    });
    setup(`${PATHNAME}?path=wbm_output/`);
    await screen.findByText("a.txt");
    expect(fetchTreeListing).toHaveBeenCalledTimes(1);

    fireEvent.click(crumbs().getByRole("link", { name: "Root" }));
    await screen.findByText("metadata.json");
    act(() => nav.go(-1));
    await screen.findByText("a.txt");
    // Both folders were seen already: going back asks nothing again.
    expect(fetchTreeListing).toHaveBeenCalledTimes(2);
  });

  it("says a folder is empty", async () => {
    serve({ "": [listing("")] });
    setup();
    await screen.findByText("This folder is empty.");
  });

  it("appends the next page on Load more and drops the button on the last page", async () => {
    serve({
      "": [
        listing("", { files: [file("f1.txt")], nextCursor: "tok-2" }),
        listing("", { files: [file("f2.txt")], nextCursor: null }),
      ],
    });
    setup();
    await screen.findByText("f1.txt");
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await screen.findByText("f2.txt");
    expect(screen.getByText("f1.txt")).toBeTruthy();
    expect(fetchTreeListing).toHaveBeenLastCalledWith("snapshot", "snap-1", "", "tok-2");
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("keeps the rows and offers Try again when a next page fails", async () => {
    vi.mocked(fetchTreeListing)
      .mockResolvedValueOnce(listing("", { files: [file("f1.txt")], nextCursor: "tok-2" }))
      .mockResolvedValueOnce({ ok: false, code: "listing_unavailable" })
      .mockResolvedValueOnce(listing("", { files: [file("f2.txt")] }));
    setup();
    await screen.findByText("f1.txt");
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await screen.findByText("The next entries could not be loaded.");
    expect(screen.getByText("f1.txt")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("f2.txt");
  });

  it("retries a listing the storage service did not answer", async () => {
    vi.mocked(fetchTreeListing)
      .mockResolvedValueOnce({ ok: false, code: "listing_unavailable" })
      .mockResolvedValueOnce(ROOT);
    setup();
    await screen.findByText(/listing is unavailable/);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("metadata.json");
    expect(fetchTreeListing).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["path_not_found", "This folder is not in the tree."],
    ["invalid_path", "That is not a valid folder path."],
  ] as const)("links back to the root on %s", async (code, message) => {
    vi.mocked(fetchTreeListing).mockResolvedValue({ ok: false, code });
    setup(`${PATHNAME}?path=nope/`);
    await screen.findByText(message);
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    vi.mocked(fetchTreeListing).mockResolvedValue(ROOT);
    fireEvent.click(screen.getByRole("link", { name: "Back to the root of the tree" }));
    await screen.findByText("metadata.json");
    expect(nav.currentEntry.url).toBe(`${window.location.origin}${PATHNAME}`);
  });
});

describe("TreeBrowser preview", () => {
  it("opens a previewable file in the sheet and sets ?file=", async () => {
    serve({ "": [ROOT] });
    vi.mocked(fetchTreePreview).mockResolvedValue(preview({ text: "line one\nline two\n" }));
    setup();
    fireEvent.click(await screen.findByRole("link", { name: "metadata.json" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByTestId("preview-text");
    expect(fetchTreePreview).toHaveBeenCalledWith("snapshot", "snap-1", "metadata.json");
    expect(nav.currentEntry.url).toContain("?file=metadata.json");
    expect(within(dialog).getByTestId("preview-text").textContent).toBe("line one\nline two");
    expect(within(dialog).getByTestId("line-numbers").textContent).toBe("1\n2");
    expect(within(dialog).getByRole("link", { name: "Download" }).getAttribute("href")).toBe(
      `${BASE}metadata.json`
    );
  });

  it("does not make a link of a file that is not previewable", async () => {
    serve({ "": [ROOT] });
    setup();
    await screen.findByText("grid.nc");
    expect(screen.queryByRole("link", { name: "grid.nc" })).toBeNull();
  });

  it("pretty-prints a .json file", async () => {
    serve({ "": [ROOT] });
    vi.mocked(fetchTreePreview).mockResolvedValue(preview({ text: '{"a":[1,2]}' }));
    setup(`${PATHNAME}?file=metadata.json`);
    const text = await screen.findByTestId("preview-text");
    expect(text.textContent).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}');
  });

  it("notes that a long file is cut", async () => {
    serve({ "": [ROOT] });
    vi.mocked(fetchTreePreview).mockResolvedValue(
      preview({ text: "abc", truncated: true, size: 4.2 * 1024 * 1024 })
    );
    setup(`${PATHNAME}?file=metadata.json`);
    await screen.findByText("Showing the first 256 KB of 4.2 MB. Download it for the whole file.");
  });

  it("says there is no preview for a binary result", async () => {
    serve({ "": [ROOT] });
    vi.mocked(fetchTreePreview).mockResolvedValue(preview({ kind: "binary", text: null, size: 5000 }));
    setup(`${PATHNAME}?file=SHA256SUMS`);
    await screen.findByText("No preview for this file");
    expect(screen.queryByTestId("preview-text")).toBeNull();
    expect(screen.getByRole("link", { name: "Download" }).getAttribute("href")).toBe(`${BASE}SHA256SUMS`);
  });

  it("shows no preview for a file the listing says is not previewable, whatever the backend answers", async () => {
    serve({ "": [ROOT] });
    vi.mocked(fetchTreePreview).mockResolvedValue(preview({ text: "not shown" }));
    setup(`${PATHNAME}?file=grid.nc`);
    await screen.findByText("No preview for this file");
    expect(screen.queryByTestId("preview-text")).toBeNull();
  });

  it("shows a skeleton while it loads, then retries a preview the storage service did not answer", async () => {
    serve({ "": [ROOT] });
    vi.mocked(fetchTreePreview)
      .mockResolvedValueOnce({ ok: false, code: "preview_unavailable" })
      .mockResolvedValueOnce(preview({ text: "back again" }));
    setup(`${PATHNAME}?file=metadata.json`);
    expect(await screen.findByRole("status", { name: "Loading preview" })).toBeTruthy();
    await screen.findByText(/preview is unavailable/);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByTestId("preview-text").textContent).toBe("back again"));
    expect(fetchTreePreview).toHaveBeenCalledTimes(2);
  });

  it("links to the root when the file is not there", async () => {
    serve({ "": [ROOT] });
    vi.mocked(fetchTreePreview).mockResolvedValue({ ok: false, code: "path_not_found" });
    setup(`${PATHNAME}?file=gone.txt`);
    await screen.findByText("This file is not in the tree.");
    expect(screen.getByRole("link", { name: "Back to the root of the tree" })).toBeTruthy();
  });

  it("closes on Escape by pushing the folder's URL without ?file=, and Back reopens it", async () => {
    serve({
      "": [ROOT],
      "wbm_init/": [listing("wbm_init/", { files: [file("wbm_init/a.init")] })],
    });
    vi.mocked(fetchTreePreview).mockResolvedValue(preview());
    setup(`${PATHNAME}?path=wbm_init/`);
    fireEvent.click(await screen.findByRole("link", { name: "a.init" }));
    await screen.findByRole("dialog");
    expect(nav.currentEntry.url).toContain("path=wbm_init/&file=wbm_init/a.init");

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(nav.currentEntry.url).toContain("?path=wbm_init/");
    expect(nav.currentEntry.url).not.toContain("file=");

    act(() => nav.go(-1));
    await screen.findByRole("dialog");
  });

  it("opens a file from a pasted ?file= link in its own folder, with a download link even when the listing does not hold it", async () => {
    serve({
      "wbm_init/": [listing("wbm_init/", { files: [file("wbm_init/other.init")], nextCursor: "tok" })],
    });
    vi.mocked(fetchTreePreview).mockResolvedValue(preview());
    setup(`${PATHNAME}?file=wbm_init/later.init`);
    await screen.findByText("other.init");
    expect(fetchTreeListing).toHaveBeenCalledWith("snapshot", "snap-1", "wbm_init/");
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("link", { name: "Download" }).getAttribute("href")).toBe(
      `${BASE}wbm_init/later.init`
    );
  });
});

describe("TreeBrowser selection", () => {
  const box = (name: string) => screen.getByRole("checkbox", { name });

  it("puts a checkbox in front of every row, and shows no bar until one is ticked", async () => {
    serve({ "": [ROOT] });
    setup();
    await screen.findByText("metadata.json");
    for (const name of ["Select wbm_init/", "Select wbm_output/", "Select metadata.json", "Select SHA256SUMS", "Select grid.nc", "Select all"]) {
      expect(box(name)).toBeTruthy();
    }
    expect(screen.queryByRole("button", { name: "Download ZIP" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("totals what is ticked, files at their listed size and a folder by its summary, and posts them as one form", async () => {
    fetchMock.mockImplementation(async () =>
      Response.json({ path: "wbm_init/", url: `${BASE}wbm_init/`, files: 3, bytes: 4096, limit_bytes: 500 * 1024 ** 2, fits: true, complete: true })
    );
    serve({ "": [ROOT] });
    setup();
    await screen.findByText("metadata.json");
    fireEvent.click(box("Select metadata.json"));
    fireEvent.click(box("Select wbm_init/"));
    expect(fetchMock).toHaveBeenCalledWith("/api/repository/datasets/snap-1/files/folder?path=wbm_init/");
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("2 selected · 6.0 KB"));
    const form = screen.getByRole("button", { name: "Download ZIP" }).closest("form") as HTMLFormElement;
    expect(form.getAttribute("action")).toBe("/api/repository/datasets/snap-1/files/archive");
    const data = new FormData(form);
    expect([data.get("folder"), ...data.getAll("names")]).toEqual(["", "metadata.json", "wbm_init/"]);
  });

  it("says a selection over the limit is, at once, and clears when another folder is opened", async () => {
    fetchMock.mockImplementation(async () =>
      Response.json({ path: "wbm_output/", url: `${BASE}wbm_output/`, files: 9, bytes: 7 * 1024 ** 3, limit_bytes: 500 * 1024 ** 2, fits: false, complete: true })
    );
    serve({
      "": [ROOT],
      "wbm_init/": [listing("wbm_init/", { files: [file("wbm_init/a.init")] })],
    });
    setup();
    await screen.findByText("metadata.json");
    fireEvent.click(box("Select wbm_output/"));
    await screen.findByText("The selection is 7.0 GB, over the 500 MB limit for a ZIP. Select less, or use an S3 tool.");
    expect((screen.getByRole("button", { name: "Download ZIP" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("link", { name: "wbm_init/" }));
    await screen.findByText("a.init");
    expect(screen.queryByRole("button", { name: "Download ZIP" })).toBeNull();
    expect(box("Select a.init").getAttribute("aria-checked")).toBe("false");
  });
});
