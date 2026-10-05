import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/repository/actions", () => ({ fetchDatasetById: vi.fn() }));

import { fetchDatasetById } from "@/lib/repository/actions";
import { runNotes } from "@/lib/jobs/run-notes";
import { fakeDataset, fakeDraft } from "@/lib/workspace/fixtures";

function covering(start: string, end: string) {
  const base = fakeDataset();
  return fakeDataset({ simulation: { ...base.simulation, temporalCoverage: { start, end } } });
}

const ran = (id: string, datasetId: string, start: string, end: string) =>
  fakeDraft("COMPLETED", {
    id,
    dataset_id: datasetId,
    parameters: { ...fakeDraft("COMPLETED").parameters, temporal_range_start: start, temporal_range_end: end },
  });

describe("runNotes", () => {
  beforeEach(() => {
    vi.mocked(fetchDatasetById).mockReset();
  });

  it("reads each distinct snapshot once and returns a note only for a shorter run", async () => {
    vi.mocked(fetchDatasetById).mockResolvedValue(covering("2000-01-01", "2009-12-31"));
    const whole = ran("a", "ds-1", "2000-01-01", "2009-12-31");
    const part = ran("b", "ds-1", "2000-01-01", "2005-12-31");
    const notes = await runNotes([whole, part]);
    expect(fetchDatasetById).toHaveBeenCalledTimes(1);
    expect(notes).toEqual({ b: "Run 2000–2005" });
  });

  it("still says the run period when a snapshot is gone or cannot be read", async () => {
    vi.mocked(fetchDatasetById).mockImplementation((id) =>
      id === "gone" ? Promise.resolve(null) : Promise.reject(new Error("backend down"))
    );
    const a = ran("a", "gone", "2000-01-01", "2001-12-31");
    const b = ran("b", "down", "2000-01-01", "2001-12-31");
    expect(await runNotes([a, b])).toEqual({ a: "Run 2000–2001", b: "Run 2000–2001" });
  });
});
