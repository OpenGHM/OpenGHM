import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

// The site header reads the session, which these tests have no provider for.
vi.mock("@/components/landing/header", () => ({ Header: () => null }));
vi.mock("@/lib/jobs/actions", () => ({
  pollJobStatus: vi.fn(),
  cancelJob: vi.fn(),
  deleteDraft: vi.fn(),
  deriveDraft: vi.fn(),
  duplicateDraft: vi.fn(),
  submitDraft: vi.fn(),
}));
// The Run details card asks for the parameter tree of a run that changed some.
vi.mock("@/lib/repository/actions", () => ({ fetchModelParameters: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/workspace/x",
}));

import { JobDetail } from "@/components/workspace/job-detail";
import { fakeLive, fakeLogs, previewDraftJob } from "@/lib/workspace/fixtures";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(cleanup);

function renderDetail(key: string) {
  const job = previewDraftJob(key);
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
  it("titles the page with the snapshot draft's name and puts the breadcrumb in the header", () => {
    renderDetail("completed");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("WBM simulation as tutorial: [Global] · 2001");
    expect(screen.getByRole("link", { name: "My snapshot drafts" }).getAttribute("href")).toBe("/workspace");
    expect(screen.queryByText("Back to snapshot drafts")).toBeNull();
  });

  it("reads status, then the run details, then the publish card and the logs", () => {
    renderDetail("completed");
    const status = screen.getByRole("region", { name: "Status" });
    const details = screen.getByRole("complementary", { name: "Run details" });
    const publish = screen.getByRole("heading", { name: "Publish as snapshot" });
    const logs = screen.getByRole("heading", { name: "Logs" });
    // The aside follows the status summary in the page, so below xl it comes right after it.
    expect(before(status, details)).toBe(true);
    expect(before(details, publish)).toBe(true);
    expect(before(publish, logs)).toBe(true);
    // The old layout's sidebar cards and icon-tile headers are gone, and so is the Details section.
    expect(screen.queryByText("Job Status")).toBeNull();
    expect(screen.queryByText("Snapshot draft parameters")).toBeNull();
    expect(screen.queryByText("HPC Configuration")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Details" })).toBeNull();
  });

  it("puts the Run details in a column from xl, beside the status, publish and logs", () => {
    const { container } = renderDetail("completed");
    const aside = screen.getByRole("complementary", { name: "Run details" });
    for (const name of ["xl:self-start", "xl:col-start-2"]) {
      expect(aside.classList.contains(name)).toBe(true);
    }
    expect(aside.classList.contains("xl:sticky")).toBe(false);
    // Not hidden below xl: it is in the page's flow there.
    expect(aside.classList.contains("hidden")).toBe(false);
    expect(within(aside).getByRole("heading", { level: 2, name: "Run details" })).toBeTruthy();
    const grid = aside.parentElement!;
    expect(grid.className).toContain("xl:grid");
    // Status and the rest are the grid's first column; the aside is not inside them.
    expect(grid.contains(screen.getByRole("region", { name: "Status" }))).toBe(true);
    expect(aside.contains(screen.getByRole("region", { name: "Status" }))).toBe(false);
    expect(aside.contains(screen.getByRole("heading", { name: "Logs" }))).toBe(false);
    // The body is the page's own column, under the navy band.
    expect(grid.parentElement?.className).toContain("max-w-[1360px]");
    expect((container.firstElementChild as HTMLElement).className).toContain("bg-hero");
  });

  it("says each fact once: the cores, the run period and the times are in the card, not in the main column", () => {
    renderDetail("completed");
    const aside = screen.getByRole("complementary", { name: "Run details" });
    const main = screen.getByRole("main");
    for (const label of ["Cores", "Walltime", "Run period", "Submitted", "Started", "Ended", "Slurm job"]) {
      const terms = screen.getAllByText(label, { selector: "dt" });
      expect(terms).toHaveLength(1);
      expect(aside.contains(terms[0])).toBe(true);
    }
    expect(main.textContent).not.toMatch(/Submitted \d|Waited \d|Ran \d/);
  });

  it("keeps the retry in one place on a failed simulation: the summary has the retry, the header the snapshot and Delete", () => {
    renderDetail("failed:wbm_error");
    expect(screen.getAllByRole("button", { name: "Try again with these settings" })).toHaveLength(1);
    expect(screen.getAllByRole("link", { name: "New from this model snapshot" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Delete snapshot draft" })).toBeTruthy();
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
    expect(screen.getAllByRole("button", { name: "Cancel simulation" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Delete snapshot draft" })).toBeNull();
  });
});
