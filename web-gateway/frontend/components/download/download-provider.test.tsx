import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DownloadJob, DownloadState } from "@/lib/download/engine";

// The engine is driven by hand: each test says when the download reports and ends.
const runs: { report: (s: DownloadState) => void; finish: () => void }[] = [];
vi.mock("@/lib/download/engine", () => ({
  runDownload: (_job: DownloadJob, _signal: AbortSignal, report: (s: DownloadState) => void) =>
    new Promise<void>((resolve) => runs.push({ report, finish: resolve })),
}));

import { DIALOG_DELAY_MS, DownloadProvider, SMALL_DIALOG_DELAY_MS, useDownload } from "./download-provider";

const JOB: DownloadJob = { title: "notes.txt · 1 KB", filename: "notes.txt", url: "https://s3.example/notes.txt" };
let job: DownloadJob = JOB;

function Starter() {
  const { start } = useDownload();
  return (
    <button type="button" onClick={() => start(job)}>
      go
    </button>
  );
}

function begin() {
  render(
    <DownloadProvider>
      <Starter />
    </DownloadProvider>
  );
  fireEvent.click(screen.getByRole("button", { name: "go" }));
  return runs[runs.length - 1];
}

async function end(run: (typeof runs)[number], state: DownloadState) {
  await act(async () => {
    run.report(state);
    run.finish();
  });
}

beforeEach(() => {
  runs.length = 0;
  job = JOB;
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the download dialog", () => {
  it("does not open for a download that ends quickly", async () => {
    const run = begin();
    await end(run, { phase: "done", filename: "notes.txt" });
    act(() => vi.advanceTimersByTime(DIALOG_DELAY_MS * 2));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens when a download takes longer, and says when it is done", async () => {
    const run = begin();
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => vi.advanceTimersByTime(DIALOG_DELAY_MS));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Preparing your download")).toBeTruthy();
    await end(run, { phase: "done", filename: "notes.txt" });
    expect(screen.getByText("Download complete")).toBeTruthy();
  });

  it("waits longer before opening for a small file read from S3", async () => {
    job = { ...JOB, expectedBytes: 36 * 1024, direct: true };
    const run = begin();
    act(() => vi.advanceTimersByTime(DIALOG_DELAY_MS + 200));
    expect(screen.queryByRole("dialog")).toBeNull();
    await end(run, { phase: "done", filename: "notes.txt" });
    act(() => vi.advanceTimersByTime(SMALL_DIALOG_DELAY_MS));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens at the short delay for a small download the gateway prepares", () => {
    job = { ...JOB, url: "/api/subset", expectedBytes: 36 * 1024 };
    begin();
    act(() => vi.advanceTimersByTime(DIALOG_DELAY_MS));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("opens at once for a failure, however quick", async () => {
    const run = begin();
    await end(run, { phase: "failed", message: "Select less." });
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Select less.")).toBeTruthy();
  });
});
