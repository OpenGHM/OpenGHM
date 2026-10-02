import { describe, expect, it } from "vitest";
import { lineSeverity } from "@/lib/workspace/log-severity";

describe("lineSeverity", () => {
  it.each([
    "error: Detected 1 oom_kill event in StepId=14385612.batch. Some of the step tasks have been OOM Killed.",
    "slurmstepd: error: Detected 1 oom_kill event",
    "sbatch: error: Batch job submission failed: Invalid account",
    "srun: error: anvil-a001: task 0: Out Of Memory",
    "Traceback (most recent call last):",
    "ValueError: Aggregation multi-year start is outside of the run dates",
    "FileNotFoundError: [Errno 2] No such file or directory: 'x'",
    "java.lang.IllegalStateException: boom",
    "Segmentation fault (core dumped)",
    "FATAL: could not open the cache",
    "Download failed for 3 files",
    "step run failed with rc=1",
    "Killed",
    "Aborted",
    "the job was aborted",
    "ERROR 2026-10-03 something broke",
    "Out of memory: Killed process 4242",
    "outcome: fail",
    "╭─ openghm sim run ✗ exit -9 ──────────╮",
    "step exited with exit code 1",
    "downloaded 34, skipped 12, failed 3",
  ])("calls %j an error", (line) => {
    expect(lineSeverity(line)).toBe("error");
  });

  it.each([
    "WARNING: the grid is coarser than the forcing",
    "warn: using the default",
    "/x/y.py:12: UserWarning: this will change",
    "FutureWarning: the old call is deprecated",
  ])("calls %j a warning", (line) => {
    expect(lineSeverity(line)).toBe("warning");
  });

  it("calls a line with both an error and a warning an error", () => {
    expect(lineSeverity("warning: step failed")).toBe("error");
  });

  it("keeps the module preamble plain: it is setup, not trouble", () => {
    for (const line of [
      "The following modules were not unloaded:",
      "  (Use \"module --force purge\" to unload all):",
      "  1) xalt/2.10.45 (sticky)",
      "Currently Loaded Modules:",
      "  1) xalt/2.10.45   2) gcc/11.2.0   3) openmpi/4.1.6",
      "Inactive Modules: nothing",
    ]) {
      expect(lineSeverity(line)).toBeNull();
    }
  });

  it("keeps ordinary job lines plain", () => {
    for (const line of [
      "openghm 0.2.0 commit 8c3077b",
      "downloaded 32959 files",
      "downloaded 34, skipped 32960, failed 0 (488.8 MB downloaded)",
      "failed: 0",
      "failures=0",
      "0 failed, 12 passed",
      "exit 0",
      "outcome: ok",
      "  1000/32959 files",
      "Spinup 3/12 (1991-01-03)",
      "0 errors",
      "error_count=0",
      "a snapshot called Terrors",
      "",
    ]) {
      expect(lineSeverity(line)).toBeNull();
    }
  });
});
