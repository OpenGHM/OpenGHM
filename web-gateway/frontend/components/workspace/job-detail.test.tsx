import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/lib/jobs/actions", () => ({
  pollJobStatus: vi.fn(),
  cancelJob: vi.fn(),
  deleteSimulation: vi.fn(),
  deriveSimulation: vi.fn(),
  duplicateSimulation: vi.fn(),
  submitSimulation: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/workspace/x",
}));

import { JobDetail } from "@/components/workspace/job-detail";
import { fakeLive, fakeLogs, previewSimulation } from "@/lib/workspace/fixtures";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(cleanup);

function renderDetail(key: string) {
  const job = previewSimulation(key);
  return render(
    <JobDetail
      job={job}
      viewerEmail={null}
      preview
      previewLogs={fakeLogs(job.status)}
      previewLive={fakeLive(job)}
    />
  );
}

/** True when `a` comes before `b` in the document, which is the reading order. */
function before(a: HTMLElement, b: HTMLElement) {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

describe("the detail page", () => {
  it("titles the page with the simulation's name and puts the breadcrumb in the header", () => {
    renderDetail("completed");
    const job = previewSimulation("completed");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(job.sim_id);
    expect(screen.getByRole("link", { name: "My Simulations" }).getAttribute("href")).toBe("/workspace");
    expect(screen.queryByText("Back to Simulations")).toBeNull();
  });

  it("reads status, then logs, then details", () => {
    renderDetail("completed");
    const status = screen.getByRole("region", { name: "Status" });
    const logs = screen.getByRole("heading", { name: "Logs" });
    const details = screen.getByRole("heading", { name: "Details" });
    expect(before(status, logs)).toBe(true);
    expect(before(logs, details)).toBe(true);
    // The old layout's sidebar cards and icon-tile headers are gone.
    expect(screen.queryByText("Job Status")).toBeNull();
    expect(screen.queryByText("Simulation Parameters")).toBeNull();
    expect(screen.queryByText("HPC Configuration")).toBeNull();
  });

  it("keeps the retry in one place on a failed run: the summary has the retry, the header the snapshot and Delete", () => {
    renderDetail("failed:wbm_error");
    expect(screen.getAllByRole("button", { name: "Try again with these settings" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "New from this model snapshot" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Delete simulation" })).toBeTruthy();
  });

  it.each([
    ["completed", "Duplicate"],
    ["failed:timeout", "Try again with these settings"],
    ["failed:wbm_error", "Try again with these settings"],
    ["cancelled:user", "Try again with these settings"],
  ])("offers the copy action once on an ended job (%s): %s", (key, label) => {
    renderDetail(key);
    const copy = screen
      .getAllByRole("button")
      .filter((b) => b.textContent === "Duplicate" || b.textContent === "Try again with these settings");
    expect(copy.map((b) => b.textContent)).toEqual([label]);
  });

  it("has no copy action while the job is active", () => {
    renderDetail("running");
    expect(screen.queryByRole("button", { name: "Duplicate" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Try again with these settings" })).toBeNull();
  });

  it("puts Cancel in the summary while it runs, and nothing in the header", () => {
    renderDetail("running");
    expect(screen.getAllByRole("button", { name: "Cancel" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Delete simulation" })).toBeNull();
  });
});
