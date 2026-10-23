import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ActionResult } from "@/lib/jobs/types";
import type { ModelParameters } from "@/lib/workspace/model-parameters";

vi.mock("@/lib/repository/actions", () => ({ fetchModelParameters: vi.fn() }));

import { fetchModelParameters } from "@/lib/repository/actions";
import { fakeModelParameters } from "@/lib/workspace/fixtures";
import { forgetModelParameters, useModelParameters } from "@/lib/workspace/use-model-parameters";

const fetchMock = vi.mocked(fetchModelParameters);
const tree = fakeModelParameters();
const ok = (data: ModelParameters): ActionResult<ModelParameters> => ({ ok: true, data });
const refused = (status: number, code?: string, message = "refused"): ActionResult<ModelParameters> => ({
  ok: false,
  reason: "error",
  status,
  code,
  message,
});

beforeEach(() => {
  fetchMock.mockReset();
  forgetModelParameters();
});
afterEach(cleanup);

describe("useModelParameters", () => {
  it("is loading, then the tree the backend resolved", async () => {
    fetchMock.mockResolvedValue(ok(tree));
    const { result } = renderHook(() => useModelParameters("snap-1"));
    expect(result.current.state).toEqual({ status: "loading" });
    await waitFor(() => expect(result.current.state).toEqual({ status: "ready", tree }));
    expect(fetchMock).toHaveBeenCalledWith("snap-1");
  });

  it("does not ask again for a snapshot it has read", async () => {
    fetchMock.mockResolvedValue(ok(tree));
    const first = renderHook(() => useModelParameters("snap-1"));
    await waitFor(() => expect(first.result.current.state.status).toBe("ready"));
    first.unmount();
    const second = renderHook(() => useModelParameters("snap-1"));
    expect(second.result.current.state.status).toBe("ready");
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("is unavailable for a 503 init_unavailable and for a dataset that is not a snapshot", async () => {
    fetchMock.mockResolvedValueOnce(refused(503, "init_unavailable"));
    const first = renderHook(() => useModelParameters("snap-1"));
    await waitFor(() => expect(first.result.current.state).toEqual({ status: "unavailable" }));
    fetchMock.mockResolvedValueOnce({ ok: false, reason: "not_found" });
    const second = renderHook(() => useModelParameters("snap-2"));
    await waitFor(() => expect(second.result.current.state).toEqual({ status: "unavailable" }));
  });

  it("is an error with the backend's words for any other failure, and asks again on retry", async () => {
    fetchMock.mockResolvedValueOnce(refused(500, "server_error", "The server hit a problem."));
    const { result } = renderHook(() => useModelParameters("snap-1"));
    await waitFor(() =>
      expect(result.current.state).toEqual({ status: "error", message: "The server hit a problem." })
    );
    fetchMock.mockResolvedValueOnce(ok(tree));
    act(() => result.current.retry());
    expect(result.current.state).toEqual({ status: "loading" });
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("says so when the session ended, and when the call threw", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, reason: "session_expired" });
    const first = renderHook(() => useModelParameters("snap-1"));
    await waitFor(() => expect(first.result.current.state.status).toBe("error"));
    expect(first.result.current.state).toMatchObject({ message: expect.stringMatching(/session/i) });
    fetchMock.mockRejectedValueOnce(new Error("down"));
    const second = renderHook(() => useModelParameters("snap-2"));
    await waitFor(() => expect(second.result.current.state).toMatchObject({ status: "error" }));
  });

  it("loads again for another snapshot", async () => {
    fetchMock.mockResolvedValue(ok(tree));
    const { result, rerender } = renderHook(({ id }) => useModelParameters(id), { initialProps: { id: "a" } });
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    rerender({ id: "b" });
    expect(result.current.state).toEqual({ status: "loading" });
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
