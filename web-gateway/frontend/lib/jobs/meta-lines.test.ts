import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/repository/actions", () => ({ fetchDatasetById: vi.fn() }));

import { fetchDatasetById } from "@/lib/repository/actions";
import { simulationMetaLines } from "@/lib/jobs/meta-lines";
import { fakeDataset, fakeSimulation } from "@/lib/workspace/fixtures";

const WORLD = { northlimit: 85, southlimit: -60, eastlimit: 180, westlimit: -180, units: "Decimal degrees", projection: "EPSG:4326" } as const;

function world() {
  const base = fakeDataset();
  return fakeDataset({
    simulation: {
      ...base.simulation,
      spatialCoverage: WORLD,
      temporalCoverage: { start: "2000-01-01", end: "2009-12-31" },
    },
    uses: { ...base.uses, container: { ...base.uses.container, version: "1.0.0" } },
  });
}

describe("simulationMetaLines", () => {
  beforeEach(() => {
    vi.mocked(fetchDatasetById).mockReset();
  });

  it("reads each distinct snapshot once and keys the lines by job id", async () => {
    vi.mocked(fetchDatasetById).mockResolvedValue(world());
    const a = fakeSimulation("COMPLETED", { id: "a", dataset_id: "ds-1" });
    const b = fakeSimulation("FAILED", { id: "b", dataset_id: "ds-1" });
    const lines = await simulationMetaLines([a, b]);
    expect(fetchDatasetById).toHaveBeenCalledTimes(1);
    expect(Object.keys(lines)).toEqual(["a", "b"]);
    expect(lines.a).toContain("WBM 1.0.0 · 2000–2009 · Global");
  });

  it("falls back per job when a snapshot is gone or cannot be read", async () => {
    vi.mocked(fetchDatasetById).mockImplementation((id) =>
      id === "gone" ? Promise.resolve(null) : Promise.reject(new Error("backend down"))
    );
    const a = fakeSimulation("COMPLETED", { id: "a", dataset_id: "gone", dataset_title: "Gone snapshot" });
    const b = fakeSimulation("COMPLETED", { id: "b", dataset_id: "down", dataset_title: "Down snapshot" });
    const lines = await simulationMetaLines([a, b]);
    expect(lines.a).toContain("Gone snapshot");
    expect(lines.b).toContain("Down snapshot");
  });
});
