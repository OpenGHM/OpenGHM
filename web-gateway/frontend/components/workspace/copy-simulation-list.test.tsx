import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Job } from "@/lib/jobs/types";

const { fetchJobs } = vi.hoisted(() => ({ fetchJobs: vi.fn() }));
vi.mock("@/lib/jobs/actions", () => ({ fetchJobs }));

import { CopySimulationList, type CopyListPage } from "@/components/workspace/copy-simulation-list";
import { fakeSimulation } from "@/lib/workspace/fixtures";

afterEach(cleanup);
beforeEach(() => fetchJobs.mockReset());

const FAILED = fakeSimulation("FAILED", {
  id: "job-failed",
  sim_id: "sim-20260920-aaaaaa",
  dataset_title: "Global WBM",
  about: { name: "Calibration run" } as Job["about"],
});
const DRAFT = fakeSimulation("DRAFT", { id: "job-draft-12345678", sim_id: "", dataset_title: "Global WBM" });
const PAGE1: CopyListPage = { items: [FAILED, DRAFT], page: 1, totalPages: 1 };

function list(over: Partial<React.ComponentProps<typeof CopySimulationList>> = {}) {
  const onCopy = vi.fn();
  const view = render(
    <CopySimulationList
      initial={PAGE1}
      onCopy={onCopy}
      pendingId={null}
      disabled={false}
      rowError={null}
      {...over}
    />
  );
  return { onCopy, ...view };
}

describe("the rows", () => {
  it("show the name the list uses, the status, what it is based on and when it changed", () => {
    list();
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    const first = within(rows[0]);
    expect(first.getByText("Calibration run")).toBeTruthy();
    expect(first.getByText("Failed")).toBeTruthy();
    expect(first.getByText("Model Snapshot")).toBeTruthy();
    expect(first.getByText("Global WBM")).toBeTruthy();
    expect(first.getByText(/Updated/)).toBeTruthy();
    // A draft has no run id: the same Untitled (<id8>) as the list.
    expect(within(rows[1]).getByText("Untitled (job-draf)")).toBeTruthy();
    expect(within(rows[1]).getByText("Draft")).toBeTruthy();
  });

  it("copies the row whose button was pressed", () => {
    const { onCopy } = list();
    fireEvent.click(screen.getByRole("button", { name: "Copy Calibration run" }));
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(onCopy.mock.calls[0][0].id).toBe("job-failed");
  });

  it("turns every Copy off while one is being made, with a spinner on that row", () => {
    list({ disabled: true, pendingId: "job-failed" });
    const buttons = screen.getAllByRole("button", { name: /^Copy / });
    expect(buttons.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    expect(screen.getByRole("button", { name: "Copy Calibration run" }).getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("button", { name: /^Copy Untitled/ }).getAttribute("aria-busy")).toBeNull();
  });

  it("shows a row's own error on that row only", () => {
    list({ rowError: { jobId: "job-failed", message: "The snapshot is gone." } });
    expect(within(screen.getAllByRole("listitem")[0]).getByRole("alert").textContent).toBe("The snapshot is gone.");
    expect(within(screen.getAllByRole("listitem")[1]).queryByRole("alert")).toBeNull();
  });

  it("says so when there is nothing to copy", () => {
    list({ initial: { items: [], page: 1, totalPages: 1 } });
    expect(screen.getByText("You have no simulations to copy yet")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });
});

describe("paging", () => {
  const TWO_PAGES: CopyListPage = { items: [FAILED], page: 1, totalPages: 2 };

  it("has no pager for one page", () => {
    list();
    expect(screen.queryByRole("navigation", { name: "Pages" })).toBeNull();
  });

  it("fetches the next page, then the previous one, and keeps the page here", async () => {
    fetchJobs.mockResolvedValueOnce({ items: [DRAFT], page: 2, total_pages: 2, total_count: 2 });
    list({ initial: TWO_PAGES });
    expect((screen.getByRole("button", { name: "Previous" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Page 2 of 2");
    expect(fetchJobs).toHaveBeenCalledWith(2);
    expect(screen.getByText("Untitled (job-draf)")).toBeTruthy();
    expect(screen.queryByText("Calibration run")).toBeNull();
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);

    fetchJobs.mockResolvedValueOnce({ items: [FAILED], page: 1, total_pages: 2, total_count: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await screen.findByText("Page 1 of 2");
    expect(fetchJobs).toHaveBeenLastCalledWith(1);
  });

  it("keeps the rows and offers Retry when a page cannot be loaded", async () => {
    fetchJobs.mockRejectedValueOnce(new Error("boom"));
    list({ initial: TWO_PAGES });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn't load your simulations");
    expect(screen.getByText("Calibration run")).toBeTruthy();

    fetchJobs.mockResolvedValueOnce({ items: [DRAFT], page: 2, total_pages: 2, total_count: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("Page 2 of 2");
    expect(fetchJobs).toHaveBeenLastCalledWith(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("starts in the error state when the server could not read the first page", async () => {
    fetchJobs.mockResolvedValueOnce({ items: [FAILED], page: 1, total_pages: 1, total_count: 1 });
    list({ initial: null });
    expect(screen.getByRole("alert").textContent).toContain("Couldn't load your simulations");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText("Calibration run")).toBeTruthy());
    expect(fetchJobs).toHaveBeenCalledWith(1);
  });
});
