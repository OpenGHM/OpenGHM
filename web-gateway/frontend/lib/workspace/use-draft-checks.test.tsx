import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { DraftChecks, JobParameters } from "@/lib/jobs/types";

const { draftChecks } = vi.hoisted(() => ({ draftChecks: vi.fn() }));
vi.mock("@/lib/jobs/actions", () => ({ draftChecks }));

import { useDraftChecks } from "./use-draft-checks";

const PARAMS: JobParameters = {
  temporal_range_start: "2000-01-01",
  temporal_range_end: "2002-06-30",
  spatial_domain: null,
  variables: ["discharge"],
  custom_params: null,
};
const CHECKS: DraftChecks = {
  errors: [{ rule: "dataset_file_coverage", level: "error", message: "m", paths: ["MT_Code_Name.Run_End"] }],
  warnings: [{ rule: "muskingum_note", level: "info", message: "n", paths: [] }],
  files_checked: true,
};
const READY = {
  status: "ready",
  errors: CHECKS.errors,
  warnings: CHECKS.warnings,
  filesChecked: true,
};

type Props = { parameters: JobParameters; enabled: boolean };
const hook = (initial: Partial<Props> = {}) =>
  renderHook((p: Props) => useDraftChecks({ datasetId: "snap-1", ...p }), {
    initialProps: { parameters: PARAMS, enabled: true, ...initial },
  });

beforeEach(() => {
  draftChecks.mockReset();
  draftChecks.mockResolvedValue({ ok: true, data: CHECKS });
});

describe("useDraftChecks", () => {
  it("is loading, then ready, and asks with the snapshot and the parameters", async () => {
    const { result } = hook();
    expect(result.current).toEqual({ status: "loading" });
    await waitFor(() => expect(result.current).toEqual(READY));
    expect(draftChecks).toHaveBeenCalledTimes(1);
    expect(draftChecks).toHaveBeenCalledWith("snap-1", PARAMS);
  });

  it("reports that the files were not read", async () => {
    draftChecks.mockResolvedValue({ ok: true, data: { ...CHECKS, files_checked: false } });
    const { result } = hook();
    await waitFor(() => expect(result.current).toMatchObject({ status: "ready", filesChecked: false }));
  });

  it("asks nothing while it is not enabled, and asks once it is", async () => {
    const { result, rerender } = hook({ enabled: false });
    expect(result.current).toEqual({ status: "none" });
    expect(draftChecks).not.toHaveBeenCalled();
    rerender({ parameters: PARAMS, enabled: true });
    expect(result.current).toEqual({ status: "loading" });
    await waitFor(() => expect(result.current.status).toBe("ready"));
  });

  it("does not ask a draft that has no start or no end", () => {
    expect(hook({ parameters: { ...PARAMS, temporal_range_start: "" } }).result.current).toEqual({ status: "none" });
    expect(hook({ parameters: { ...PARAMS, temporal_range_end: "" } }).result.current).toEqual({ status: "none" });
    expect(draftChecks).not.toHaveBeenCalled();
  });

  it("keeps the answer when Review is left and entered again, and shows it while it is left", async () => {
    const { result, rerender } = hook();
    await waitFor(() => expect(result.current.status).toBe("ready"));
    rerender({ parameters: { ...PARAMS }, enabled: false });
    expect(result.current).toEqual(READY); // Run settings shows it beside the date it concerns
    rerender({ parameters: { ...PARAMS }, enabled: true });
    expect(result.current).toEqual(READY);
    expect(draftChecks).toHaveBeenCalledTimes(1);
  });

  it("forgets the answer for parameters that were edited, and asks again when Review shows", async () => {
    const { result, rerender } = hook();
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const edited = { ...PARAMS, temporal_range_end: "2001-12-31" };
    rerender({ parameters: edited, enabled: false });
    expect(result.current).toEqual({ status: "none" });
    draftChecks.mockResolvedValue({ ok: true, data: { errors: [], warnings: [], files_checked: true } });
    rerender({ parameters: edited, enabled: true });
    expect(result.current).toEqual({ status: "loading" });
    await waitFor(() => expect(result.current).toEqual({ status: "ready", errors: [], warnings: [], filesChecked: true }));
    expect(draftChecks).toHaveBeenCalledTimes(2);
    expect(draftChecks.mock.calls[1][1].temporal_range_end).toBe("2001-12-31");
  });

  it("asks again when a model parameter changes", async () => {
    const { result, rerender } = hook();
    await waitFor(() => expect(result.current.status).toBe("ready"));
    rerender({ parameters: { ...PARAMS, custom_params: { "Spinup.Start": "1999-01-01" } }, enabled: true });
    expect(result.current).toEqual({ status: "loading" });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(draftChecks).toHaveBeenCalledTimes(2);
  });

  it("drops an answer that arrives after the question changed", async () => {
    let first!: (value: unknown) => void;
    draftChecks.mockReturnValueOnce(new Promise((resolve) => (first = resolve)));
    const { result, rerender } = hook();
    draftChecks.mockResolvedValueOnce({ ok: true, data: { errors: [], warnings: [], files_checked: true } });
    rerender({ parameters: { ...PARAMS, temporal_range_end: "2001-12-31" }, enabled: true });
    await waitFor(() => expect(result.current).toEqual({ status: "ready", errors: [], warnings: [], filesChecked: true }));
    await act(async () => first({ ok: true, data: CHECKS }));
    expect(result.current).toEqual({ status: "ready", errors: [], warnings: [], filesChecked: true });
  });

  it("is an error when the check fails, whatever the failure", async () => {
    draftChecks.mockResolvedValue({ ok: false, reason: "error", message: "m", status: 503, code: "init_unavailable" });
    const bad = hook();
    await waitFor(() => expect(bad.result.current).toEqual({ status: "error" }));
    draftChecks.mockResolvedValue({ ok: false, reason: "session_expired" });
    const expired = hook();
    await waitFor(() => expect(expired.result.current).toEqual({ status: "error" }));
    draftChecks.mockRejectedValue(new Error("network"));
    const thrown = hook();
    await waitFor(() => expect(thrown.result.current).toEqual({ status: "error" }));
  });

  it("does not call a draft the backend refuses as invalid a failed check", async () => {
    draftChecks.mockResolvedValue({ ok: false, reason: "error", message: "bad", status: 422 });
    const { result } = hook();
    await waitFor(() => expect(result.current).toEqual({ status: "none" }));
  });

  it("asks a failed check again the next time Review shows", async () => {
    draftChecks.mockResolvedValueOnce({ ok: false, reason: "error", message: "m", status: 502 });
    const { result, rerender } = hook();
    await waitFor(() => expect(result.current).toEqual({ status: "error" }));
    rerender({ parameters: PARAMS, enabled: false });
    rerender({ parameters: PARAMS, enabled: true });
    await waitFor(() => expect(result.current).toEqual(READY));
    expect(draftChecks).toHaveBeenCalledTimes(2);
  });
});
