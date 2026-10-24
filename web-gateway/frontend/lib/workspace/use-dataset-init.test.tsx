import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ActionResult } from "@/lib/jobs/types";
import type { DatasetInit } from "@/lib/workspace/dataset-forks";

vi.mock("@/lib/repository/actions", () => ({ fetchDatasetInit: vi.fn() }));

import { fetchDatasetInit } from "@/lib/repository/actions";
import { forgetDatasetInits, useDatasetInit } from "@/lib/workspace/use-dataset-init";

const fetchMock = vi.mocked(fetchDatasetInit);
const PATH = "/wbm/data/climate/precip/x.init";
const init: DatasetInit = {
  path: PATH, name: "x.init", Code_Name: "x", Units: "mm/day", Var_Scale: "86400", Var_Offset: "0",
  Time_Series: "daily", Start_Date: "2000-01-01", End_Date: "2001-12-31",
};
const ok: ActionResult<DatasetInit> = { ok: true, data: init };

beforeEach(() => {
  fetchMock.mockReset();
  forgetDatasetInits();
});
afterEach(cleanup);

describe("useDatasetInit", () => {
  it("asks nothing until enabled, then is loading and ready", async () => {
    fetchMock.mockResolvedValue(ok);
    const { result, rerender } = renderHook(({ on }) => useDatasetInit("snap", PATH, on), { initialProps: { on: false } });
    expect(result.current).toEqual({ status: "loading" });
    expect(fetchMock).not.toHaveBeenCalled();
    rerender({ on: true });
    await waitFor(() => expect(result.current).toEqual({ status: "ready", init }));
    expect(fetchMock).toHaveBeenCalledWith("snap", PATH);
  });

  it("keeps what it read for the page's life", async () => {
    fetchMock.mockResolvedValue(ok);
    const first = renderHook(() => useDatasetInit("snap", PATH, true));
    await waitFor(() => expect(first.result.current.status).toBe("ready"));
    first.unmount();
    const second = renderHook(() => useDatasetInit("snap", PATH, true));
    expect(second.result.current.status).toBe("ready");
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("is an error with a sentence for a file the model input lacks, an expired session, a failure and a throw", async () => {
    const cases: [ActionResult<DatasetInit> | Error, RegExp][] = [
      [{ ok: false, reason: "not_found" }, /does not have this dataset/],
      [{ ok: false, reason: "session_expired" }, /session ended/],
      [{ ok: false, reason: "error", status: 503, message: "The model input could not be read right now." }, /could not be read/],
      [new Error("boom"), /Couldn't load/],
    ];
    for (const [answer, message] of cases) {
      forgetDatasetInits();
      if (answer instanceof Error) fetchMock.mockRejectedValueOnce(answer);
      else fetchMock.mockResolvedValueOnce(answer);
      const { result, unmount } = renderHook(() => useDatasetInit("snap", PATH, true));
      await waitFor(() => expect(result.current.status).toBe("error"));
      expect((result.current as { message: string }).message).toMatch(message);
      unmount();
    }
  });
});
