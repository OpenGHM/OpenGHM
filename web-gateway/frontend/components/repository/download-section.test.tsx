import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Dataset } from "@/lib/repository/types";

const { fetchDatasetLinks } = vi.hoisted(() => ({ fetchDatasetLinks: vi.fn() }));
vi.mock("@/lib/repository/actions", () => ({ fetchDatasetLinks }));
const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { SnapshotDownloadSection } from "./download-section";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const dataset = {
  id: "abc",
  uses: { container: { image: "wbm", version: "1.0.0" } },
  simulation: { outputVariables: [{ name: "runoff", fullName: "Runoff", unit: "mm/day" }] },
} as unknown as Dataset;

describe("SnapshotDownloadSection", () => {
  it("renders the card from the snapshot's links", async () => {
    fetchDatasetLinks.mockResolvedValue({
      id: "abc",
      treeUrl: "https://s3.example/openghm/snapshots/abc/",
      metadataUrl: "",
      sha256sumsUrl: "",
      fetchCommand: "openghm snapshot fetch abc",
      containerUrl: "https://s3.example/c.sif",
      containerSize: null,
      modelInputId: "mi",
      modelInputTreeUrl: "",
      output: [],
    });
    render(await SnapshotDownloadSection({ dataset, modelInputName: "Inputs" }));
    expect(screen.getByRole("heading", { name: "Download" })).toBeTruthy();
    expect(screen.getByText("wbm:1.0.0")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open model input/ }).getAttribute("href")).toBe("/repository/model-inputs/mi");
  });

  it("says downloads are unavailable, without failing the page, when the links cannot be had", async () => {
    fetchDatasetLinks.mockRejectedValue(new Error("connect ECONNREFUSED"));
    render(await SnapshotDownloadSection({ dataset, modelInputName: "Inputs" }));
    expect(screen.getByText("Downloads are unavailable right now")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("is left out when the snapshot has no links (a 404)", async () => {
    fetchDatasetLinks.mockResolvedValue(null);
    expect(await SnapshotDownloadSection({ dataset, modelInputName: "Inputs" })).toBeNull();
  });
});
