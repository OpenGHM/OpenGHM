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
  it("copies the failed simulation's settings from the card, and starts over from its snapshot in the header", () => {
    renderDetail("failed:wbm_error");
    expect(screen.getByRole("button", { name: "Try again with these settings" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "New from this model snapshot" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start a new draft" })).toBeNull();
  });


  it("has no Back button; the breadcrumb is the way back", () => {
    renderDetail("completed");
    expect(screen.queryByText("Back to Simulations")).toBeNull();
    expect(screen.getByRole("link", { name: "My Simulations" }).getAttribute("href")).toBe("/workspace");
  });

  it("puts the status column before the parameters in reading order", () => {
    renderDetail("completed");
    const status = screen.getByText("Job Status");
    const parameters = screen.getByText("Simulation Parameters");
    const hpc = screen.getByText("HPC Configuration");
    expect(before(status, parameters)).toBe(true);
    expect(before(status, hpc)).toBe(true);
  });
});
