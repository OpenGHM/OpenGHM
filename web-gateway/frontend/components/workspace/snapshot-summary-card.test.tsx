import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { SnapshotSummaryCard } from "@/components/workspace/snapshot-summary-card";
import { fakeDataset } from "@/lib/workspace/fixtures";

afterEach(cleanup);

const dataset = fakeDataset({ id: "snap-1" });

describe("SnapshotSummaryCard", () => {
  it("shows a found snapshot: name, model and version, coverage, resolution, and a link", () => {
    render(
      <SnapshotSummaryCard
        ctx={{ dataset, snapshotState: "found" }}
        datasetId="snap-1"
        fallbackTitle="Old title"
      />
    );
    expect(screen.getByText("Fake Snapshot")).toBeTruthy();
    expect(screen.queryByText("Old title")).toBeNull();
    expect(screen.getByText("wbm 2.0.0")).toBeTruthy();
    expect(screen.getByText("2001-01-01 → 2001-12-31")).toBeTruthy();
    expect(screen.getByText("0.5 degree")).toBeTruthy();
    const link = screen.getByRole("link", { name: /View in the repository/ });
    expect(link.getAttribute("href")).toBe("/repository/snap-1");
  });

  it("says a snapshot that left the repository is gone, keeps its title and does not link to it", () => {
    render(
      <SnapshotSummaryCard
        ctx={{ dataset: null, snapshotState: "gone" }}
        datasetId="snap-1"
        fallbackTitle="Kept title"
      />
    );
    expect(screen.getByText("Kept title")).toBeTruthy();
    expect(
      screen.getByText("This model snapshot is no longer in the repository, so this draft can't be submitted.")
    ).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("says it could not load a snapshot it could not fetch, and that the checks are off", () => {
    render(
      <SnapshotSummaryCard
        ctx={{ dataset: null, snapshotState: "unavailable" }}
        datasetId="snap-1"
        fallbackTitle="Kept title"
      />
    );
    expect(screen.getByText("Kept title")).toBeTruthy();
    expect(screen.getByText(/couldn't load this model snapshot/)).toBeTruthy();
    expect(screen.getByText(/the checks that need it are off/)).toBeTruthy();
    expect(screen.getByText(/Reload the page/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "View in the repository" }).getAttribute("href")).toBe(
      "/repository/snap-1"
    );
  });
});
