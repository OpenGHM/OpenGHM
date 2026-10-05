import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { JobParameters, PublishedAnswer } from "@/lib/jobs/types";

const { publishedAnswer } = vi.hoisted(() => ({ publishedAnswer: vi.fn() }));
vi.mock("@/lib/jobs/actions", () => ({ publishedAnswer }));

import { usePublishedAnswer } from "./use-published-answer";

const PARAMS: JobParameters = {
  temporal_range_start: "2000-01-01",
  temporal_range_end: "2001-12-31",
  spatial_domain: null,
  variables: ["discharge"],
  custom_params: null,
};
const ANSWERED: PublishedAnswer = {
  answered: true,
  reasons: [],
  period: { start: "2000-01-01", end: "2001-12-31" },
  run_id: "WBM_test",
  files: [
    { group: "daily", variable: null, year: 2000, key: "k", url: "https://x/k", size: 1 },
  ],
};
const NOT_ANSWERED: PublishedAnswer = {
  answered: false,
  reasons: [{ code: "spatial_domain", message: "m" }],
  period: null,
  run_id: null,
  files: [],
};

type Props = { parameters: JobParameters; modelInputId: string | null; enabled: boolean };
const hook = (initial: Partial<Props> = {}) =>
  renderHook(
    (p: Props) => usePublishedAnswer({ datasetId: "snap-1", ...p }),
    { initialProps: { parameters: PARAMS, modelInputId: null, enabled: true, ...initial } }
  );

beforeEach(() => {
  publishedAnswer.mockReset();
  publishedAnswer.mockResolvedValue({ ok: true, data: ANSWERED });
});

describe("usePublishedAnswer", () => {
  it("is loading, then answered, and asks with the parameters, the model input and the snapshot", async () => {
    const { result } = hook({ modelInputId: "mi-1" });
    expect(result.current.state).toEqual({ status: "loading" });
    await waitFor(() => expect(result.current.state).toEqual({ status: "answered", answer: ANSWERED }));
    expect(publishedAnswer).toHaveBeenCalledTimes(1);
    expect(publishedAnswer).toHaveBeenCalledWith("snap-1", PARAMS, "mi-1");
  });

  it("is none when the snapshot does not answer, and when it answers with no files", async () => {
    publishedAnswer.mockResolvedValue({ ok: true, data: NOT_ANSWERED });
    const first = hook();
    await waitFor(() => expect(first.result.current.state).toEqual({ status: "none" }));
    publishedAnswer.mockResolvedValue({ ok: true, data: { ...ANSWERED, files: [] } });
    const second = hook();
    await waitFor(() => expect(second.result.current.state).toEqual({ status: "none" }));
  });

  it("is an error when the check fails, whatever the failure", async () => {
    publishedAnswer.mockResolvedValue({ ok: false, reason: "error", message: "m", status: 502, code: "published_listing_unavailable" });
    const bad = hook();
    await waitFor(() => expect(bad.result.current.state).toEqual({ status: "error" }));
    publishedAnswer.mockResolvedValue({ ok: false, reason: "session_expired" });
    const expired = hook();
    await waitFor(() => expect(expired.result.current.state).toEqual({ status: "error" }));
    publishedAnswer.mockRejectedValue(new Error("network"));
    const thrown = hook();
    await waitFor(() => expect(thrown.result.current.state).toEqual({ status: "error" }));
  });

  it("does not call a draft the backend refuses as invalid a failed check", async () => {
    publishedAnswer.mockResolvedValue({ ok: false, reason: "error", message: "bad", status: 422 });
    const { result } = hook();
    await waitFor(() => expect(result.current.state).toEqual({ status: "none" }));
  });

  it("asks nothing while it is not enabled, and asks once it is", async () => {
    const { result, rerender } = hook({ enabled: false });
    expect(result.current.state).toEqual({ status: "none" });
    expect(publishedAnswer).not.toHaveBeenCalled();
    rerender({ parameters: PARAMS, modelInputId: null, enabled: true });
    expect(result.current.state).toEqual({ status: "loading" });
    await waitFor(() => expect(result.current.state.status).toBe("answered"));
    expect(publishedAnswer).toHaveBeenCalledTimes(1);
  });

  it("does not ask a draft that has no period or no variable", () => {
    const noVariables = hook({ parameters: { ...PARAMS, variables: [] } });
    expect(noVariables.result.current.state).toEqual({ status: "none" });
    const backwards = hook({ parameters: { ...PARAMS, temporal_range_start: "2002-01-01" } });
    expect(backwards.result.current.state).toEqual({ status: "none" });
    const noStart = hook({ parameters: { ...PARAMS, temporal_range_start: "" } });
    expect(noStart.result.current.state).toEqual({ status: "none" });
    expect(publishedAnswer).not.toHaveBeenCalled();
  });

  it("keeps the answer when the step is left and entered again with the same question", async () => {
    const { result, rerender } = hook();
    await waitFor(() => expect(result.current.state.status).toBe("answered"));
    rerender({ parameters: { ...PARAMS }, modelInputId: null, enabled: false });
    rerender({ parameters: { ...PARAMS }, modelInputId: null, enabled: true });
    expect(result.current.state.status).toBe("answered");
    expect(publishedAnswer).toHaveBeenCalledTimes(1);
  });

  it("asks again when the period or the variables change, and shows loading meanwhile", async () => {
    const { result, rerender } = hook();
    await waitFor(() => expect(result.current.state.status).toBe("answered"));
    publishedAnswer.mockResolvedValue({ ok: true, data: NOT_ANSWERED });
    rerender({ parameters: { ...PARAMS, temporal_range_end: "2001-06-30" }, modelInputId: null, enabled: true });
    expect(result.current.state).toEqual({ status: "loading" });
    await waitFor(() => expect(result.current.state).toEqual({ status: "none" }));
    expect(publishedAnswer).toHaveBeenCalledTimes(2);
    expect(publishedAnswer.mock.calls[1][1].temporal_range_end).toBe("2001-06-30");
  });

  it("drops an answer that arrives after the question changed", async () => {
    let first!: (value: unknown) => void;
    publishedAnswer.mockReturnValueOnce(new Promise((resolve) => (first = resolve)));
    const { result, rerender } = hook();
    publishedAnswer.mockResolvedValueOnce({ ok: true, data: NOT_ANSWERED });
    rerender({ parameters: { ...PARAMS, variables: ["runoff"] }, modelInputId: null, enabled: true });
    await waitFor(() => expect(result.current.state).toEqual({ status: "none" }));
    await act(async () => first({ ok: true, data: ANSWERED }));
    expect(result.current.state).toEqual({ status: "none" });
  });

  it("refresh asks the same question again", async () => {
    publishedAnswer.mockResolvedValueOnce({ ok: true, data: NOT_ANSWERED });
    const { result } = hook();
    await waitFor(() => expect(result.current.state).toEqual({ status: "none" }));
    act(() => result.current.refresh());
    expect(result.current.state).toEqual({ status: "loading" });
    await waitFor(() => expect(result.current.state.status).toBe("answered"));
    expect(publishedAnswer).toHaveBeenCalledTimes(2);
  });
});
