import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
vi.mock("@/lib/repository/actions", () => ({ fetchTreeListing: vi.fn(), fetchTreePreview: vi.fn() }));

import { ModelInputDownload, SnapshotDownload } from "@/components/repository/download-card";
import type { OutputFolder } from "@/lib/repository/types";

beforeEach(() => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});
afterEach(cleanup);

const TREE = "https://s3.example/openghm/snapshots/abc/";
const folder = (name: string, files: number, bytes: number): OutputFolder => ({
  run: "G",
  name,
  path: `wbm_output/G/${name}/`,
  files,
  bytes,
});

function renderSnapshot(output: OutputFolder[] = []) {
  return render(
    <SnapshotDownload
      id="abc"
      treeUrl={TREE}
      output={output}
      variables={[]}
      fetchCommand="openghm snapshot fetch abc"
      containerUrl="https://s3.example/openghm/containers/wbm/1.0.0/wbm-1.0.0.sif"
      containerName="wbm:1.0.0"
      containerSize={328179712}
      modelInputHref="/repository/model-inputs/mi"
      modelInputName="WBM Inputs [Global]"
    />
  );
}

describe("SnapshotDownload", () => {
  it("is a small card: the output's size and two doors into the output dialog", () => {
    renderSnapshot([folder("daily", 10, 2 * 1024 ** 3), folder("cell_area", 3, 100), folder("yearly", 511, 1024 ** 2)]);
    expect(screen.getByText("2.0 GB")).toBeTruthy();
    expect(screen.getByText(/in yearly and daily files/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Download a subset/ }).textContent).toContain("1 file");
    // Every file of the output, the ones outside the time step folders included.
    expect(screen.getByRole("button", { name: /Output files/ }).textContent).toContain("524 files");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("link", { name: /Skip the setup/ })).toBeNull();
  });

  it("opens the dialog on the tab of the door", () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));
    renderSnapshot([folder("yearly", 511, 1024 ** 2)]);
    fireEvent.click(screen.getByRole("button", { name: /Output files/ }));
    expect(within(screen.getByRole("dialog")).getByRole("tab", { name: "Output files", selected: true })).toBeTruthy();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: /Download a subset/ }));
    expect(within(screen.getByRole("dialog")).getByRole("tab", { name: "Download a subset", selected: true })).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it("says less, and still opens, when the output could not be listed", () => {
    renderSnapshot([]);
    expect(screen.getByText(/What this run produced, as NetCDF files/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Output files/ }).textContent).toContain("Folder");
  });

  it("offers what a run needs: the code, the model input, the container, and the fetch for all three", async () => {
    renderSnapshot();
    const needs = within(screen.getByRole("list", { name: "What a run needs" }));
    expect(needs.getByRole("link", { name: /Browse files/ }).getAttribute("href")).toBe("/repository/abc/files");
    expect(needs.getByRole("link", { name: "Open model input WBM Inputs [Global]" }).getAttribute("href")).toBe(
      "/repository/model-inputs/mi"
    );
    const container = needs.getByRole("link", { name: "Download the container image wbm:1.0.0" });
    expect(container.getAttribute("href")).toBe("https://s3.example/openghm/containers/wbm/1.0.0/wbm-1.0.0.sif");
    expect(needs.getByText("wbm:1.0.0 · 313.0 MB")).toBeTruthy();

    // metadata.json and SHA256SUMS are not offered by themselves.
    expect(screen.queryByText("metadata.json")).toBeNull();

    // The toolkit is not released: its command is marked, not recommended.
    expect(screen.getByText("All three at once with the CLI").textContent).toContain("Coming soon");
    expect(screen.queryByText("Recommended")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Copy command" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("openghm snapshot fetch abc");
    expect(await screen.findByText("Copied")).toBeTruthy();
  });
});

describe("ModelInputDownload", () => {
  it("offers the CLI fetch, the files page and the S3 address", () => {
    render(
      <ModelInputDownload
        id="mi"
        treeUrl="https://s3.example/openghm/model-inputs/mi/"
        fetchCommand="openghm model-input fetch mi"
      />
    );
    expect(screen.getByText("openghm model-input fetch mi")).toBeTruthy();
    expect(screen.getByText("Download with the CLI").textContent).toContain("Coming soon");
    expect(screen.getByRole("link", { name: /Browse files/ }).getAttribute("href")).toBe("/repository/model-inputs/mi/files");
    fireEvent.click(screen.getByRole("button", { name: "Copy S3 address" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("https://s3.example/openghm/model-inputs/mi/");
  });
});
