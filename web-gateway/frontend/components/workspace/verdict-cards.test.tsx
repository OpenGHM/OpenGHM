import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";

// The cards reach the server actions through the delete and derive buttons;
// rendering never calls them.
vi.mock("@/lib/jobs/actions", () => ({
  deleteSimulation: vi.fn(),
  deriveSimulation: vi.fn(),
  cancelJob: vi.fn(),
  pollJobStatus: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/workspace/x",
}));

import { CancelledNoticeCard } from "@/components/workspace/cancelled-notice-card";
import { CompletedResultsCard } from "@/components/workspace/completed-results-card";
import { FailedNextStepsCard } from "@/components/workspace/failed-next-steps-card";
import { JobStatusPanel } from "@/components/workspace/job-status-panel";
import { LiveJobProvider } from "@/components/workspace/live-job-provider";
import { previewSimulation } from "@/lib/workspace/fixtures";
import { FAILED_CAUSES, PREVIEW_GROUPS } from "@/lib/workspace/preview";
import { FAILURE_COPY } from "@/lib/workspace/failure-copy";

describe("the failed card", () => {
  it.each(FAILED_CAUSES)("renders %s with its title, message and delete", (cause) => {
    const job = previewSimulation(`failed:${cause}`);
    const html = renderToString(<FailedNextStepsCard job={job} preview />);
    const escape = (t: string) => t.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;");
    expect(html).toContain(escape(FAILURE_COPY[cause].title));
    expect(html).toContain(escape(job.failure!.message));
    expect(html).toContain("Delete simulation");
    if (job.failure?.excerpt) expect(html).toContain("Log excerpt");
    if (job.slurm_state) expect(html).toContain(job.slurm_state);
  });

  it("offers a new draft, and says to pick a longer walltime after a timeout", () => {
    const html = renderToString(
      <FailedNextStepsCard job={previewSimulation("failed:timeout")} preview />
    );
    expect(html).toContain("Start a new draft");
    expect(html).toContain("longer walltime");
  });

  it("shows the backend's message and not the per-cause body", () => {
    const job = previewSimulation("failed:out_of_memory");
    const html = renderToString(<FailedNextStepsCard job={job} preview />);
    expect(html).toContain(job.failure!.message);
    expect(html).not.toContain(FAILURE_COPY.out_of_memory.body);
  });

  it.each(FAILED_CAUSES)("shows the per-cause body when %s has no message", (cause) => {
    const base = previewSimulation(`failed:${cause}`);
    const job = { ...base, failure: { ...base.failure!, message: "" } };
    const html = renderToString(<FailedNextStepsCard job={job} preview />);
    expect(html).toContain(FAILURE_COPY[cause].body.replace(/'/g, "&#x27;"));
  });

  it("falls back to the stored reason for a job with no verdict", () => {
    const job = { ...previewSimulation("failed:wbm_error"), failure: null, status_reason: "old reason" };
    const html = renderToString(<FailedNextStepsCard job={job} preview />);
    expect(html).toContain("The run failed");
    expect(html).toContain("old reason");
  });
});

describe("the cancelled card", () => {
  it("says you, someone else, and Anvil", () => {
    const you = previewSimulation("cancelled:user", { viewerEmail: "me@purdue.edu" });
    expect(renderToString(<CancelledNoticeCard job={you} viewerEmail="me@purdue.edu" preview />)).toContain(
      "You cancelled this simulation"
    );
    const other = previewSimulation("cancelled:other");
    expect(renderToString(<CancelledNoticeCard job={other} viewerEmail="me@purdue.edu" preview />)).toContain(
      "Cancelled by colleague@example.test"
    );
    const system = previewSimulation("cancelled:system");
    expect(renderToString(<CancelledNoticeCard job={system} viewerEmail="me@purdue.edu" preview />)).toContain(
      "Cancelled by Anvil or an administrator"
    );
  });

  it("renders the same twice, so hydration has nothing to disagree about", () => {
    const job = previewSimulation("cancelled:user", { overrides: { cancel_requested_at: "2026-09-30T10:00:00Z" } });
    const a = renderToString(<CancelledNoticeCard job={job} viewerEmail={null} preview />);
    const b = renderToString(<CancelledNoticeCard job={job} viewerEmail={null} preview />);
    expect(a).toBe(b);
    expect(a).toContain("30 Sep 2026, 10:00 UTC");
  });
});

describe("the completed card", () => {
  it("shows the manifest, the path and the retention notice", () => {
    const job = previewSimulation("completed");
    // React separates adjacent text nodes with comments; the reader sees none.
    const html = renderToString(<CompletedResultsCard job={job} publishHref="/x" preview />).replace(
      /<!-- -->/g,
      ""
    );
    expect(html).toContain(job.work_dir!);
    expect(html).toContain(String(job.output!.file_count));
    expect(html).toMatch(/Anvil deletes files that are not used for 30 days — around <time[^>]*>\d+ \w+ \d{4}<\/time>\. Publish the result to keep it\./);
    expect(html).toContain("Publish as a Snapshot");
    expect(html).not.toMatch(/illustrative|not wired/i);
  });

  it("shows only the purge notice when the files are gone", () => {
    const job = previewSimulation("completed:purged");
    const html = renderToString(<CompletedResultsCard job={job} publishHref="/x" preview />);
    expect(html).toContain("purge removed this run");
    expect(html).not.toContain("Scratch path");
    expect(html).not.toContain("Publish as a Snapshot");
    expect(html).toContain("Delete simulation");
  });

  it("is honest about an old job with no record of its output", () => {
    const job = previewSimulation("completed:legacy");
    const html = renderToString(<CompletedResultsCard job={job} publishHref="/x" preview />);
    expect(html).toContain("before the gateway recorded what it wrote");
  });
});

describe("the status panel", () => {
  it("shows Cancelling, disabled, with a live region", () => {
    const job = previewSimulation("cancelling");
    const html = renderToString(
      <LiveJobProvider
        jobId={job.id}
        initialStatus={job.status}
        initialData={{ cancel_requested_at: job.cancel_requested_at }}
        preview
      >
        <JobStatusPanel preview />
      </LiveJobProvider>
    );
    expect(html).toContain("Cancelling");
    expect(html).toContain('aria-live="polite"');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[^]*?Cancelling…/);
  });
});

describe("every preview", () => {
  const all = PREVIEW_GROUPS.flatMap((g) => g.options);
  it.each(all.map((o) => o.key))("builds a job for %s", (key) => {
    const job = previewSimulation(key);
    expect(job.status).toBe(all.find((o) => o.key === key)!.status);
  });
});
