import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AnvilScratchResponse, SpoolClearResponse } from "@/lib/admin/types";

const { fetchAnvilScratch, clearSpoolCache, toast } = vi.hoisted(() => ({
  fetchAnvilScratch: vi.fn(),
  clearSpoolCache: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/lib/admin/actions", () => ({ fetchAnvilScratch, clearSpoolCache }));
vi.mock("sonner", () => ({ toast }));

import { AnvilScratchCard } from "@/components/admin/anvil-scratch-card";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const MODEL_INPUT = "0123456789abcdef0123456789abcdef";

function status(overrides: Partial<AnvilScratchResponse> = {}): AnvilScratchResponse {
  return {
    checked_at: "2026-10-06T12:00:00Z",
    quota: { files_used: 400_000, files_limit: 1_000_000, bytes_used: 2e9, bytes_limit: 100e9 },
    quota_error: null,
    high: 0.8,
    low: 0.5,
    cache_root: "/anvil/scratch/x/spool",
    variants: [
      {
        model_input_id: MODEL_INPUT,
        network: "global",
        variant: "era5",
        dir: "global/era5",
        units: 12,
        files: 4380,
        bytes: 3e9,
        last_used: "2026-10-05T12:00:00Z",
        on_s3_units: 9,
        leased_units: 2,
      },
      {
        model_input_id: "fedcba9876543210",
        network: "conus",
        variant: "nldas",
        dir: "conus/nldas",
        units: 3,
        files: 1095,
        bytes: 1e6,
        last_used: null,
        on_s3_units: 3,
        leased_units: 0,
      },
    ],
    leases: [{ sim_id: "sim-abc", variant_dir: "global/era5", units: ["2020", "2021"], expires: "2026-10-07T00:00:00Z" }],
    totals: { units: 15, files: 5475, bytes: 4e9 },
    ...overrides,
  };
}

const dryRun: SpoolClearResponse = {
  dry_run: true,
  deleted_units: 13,
  deleted_files: 4_745,
  deleted_bytes: 2e9,
  skipped_leased: 2,
  deleted: [{ variant_dir: "global/era5", unit: "2019", files: 365, bytes: 1000 }],
};

const refused = (status: number, code: string, message = "") => ({
  ok: false as const,
  reason: "error" as const,
  status,
  code,
  message: message || "Request failed",
});

async function renderLoaded(data = status()) {
  fetchAnvilScratch.mockResolvedValue({ ok: true, data });
  render(<AnvilScratchCard />);
  await screen.findByText("Scratch quota");
}

describe("the quota", () => {
  it("shows files and size as meters with their percentages", async () => {
    await renderLoaded();
    const files = screen.getByRole("progressbar", { name: "Files used" });
    expect(files.getAttribute("aria-valuenow")).toBe("40");
    expect(files.getAttribute("aria-valuetext")).toBe("400,000 of 1,000,000, 40%");
    const size = screen.getByRole("progressbar", { name: "Size used" });
    expect(size.getAttribute("aria-valuetext")).toBe("2.0 GB of 100.0 GB, 2.0%");
  });

  it("marks the prune threshold and the target on the file meter, and says why", async () => {
    await renderLoaded();
    expect(screen.getByText("80% prune")).toBeTruthy();
    expect(screen.getByText("50% target")).toBeTruthy();
    expect(
      screen.getByText(/pruned automatically at 80% of the file quota, down to 50%\. Files, not size, are the binding limit\./)
    ).toBeTruthy();
  });

  it("takes the marks from high and low", async () => {
    await renderLoaded(status({ high: 0.9, low: 0.4 }));
    expect(screen.getByText("90% prune")).toBeTruthy();
    expect(screen.getByText("40% target")).toBeTruthy();
  });

  it("shows the quota error plainly when there is no quota", async () => {
    await renderLoaded(status({ quota: null, quota_error: "lfs quota: permission denied" }));
    expect(screen.getByText("lfs quota: permission denied")).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
    // The cache below it is still shown.
    expect(screen.getByText("Spool cache")).toBeTruthy();
  });
});

describe("the spool cache", () => {
  it("shows the totals", async () => {
    await renderLoaded();
    expect(screen.getByText("5,475")).toBeTruthy();
    expect(screen.getByText("4.0 GB")).toBeTruthy();
    expect(screen.getByText("15")).toBeTruthy();
  });

  it("lists each variant, with the short model input and the full id in the title", async () => {
    await renderLoaded();
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    const first = within(rows[0]);
    const id = first.getByText("01234567");
    expect(id.getAttribute("title")).toBe(MODEL_INPUT);
    expect(first.getByText("global")).toBeTruthy();
    expect(first.getByText("era5")).toBeTruthy();
    expect(first.getByText("12")).toBeTruthy();
    expect(first.getByText("4,380")).toBeTruthy();
    expect(first.getByText("3.0 GB")).toBeTruthy();
    expect(first.getByText("9 of 12")).toBeTruthy();
    expect(first.getByText("2 in use")).toBeTruthy();
    const time = rows[0].querySelector("time");
    expect(time?.getAttribute("dateTime")).toBe("2026-10-05T12:00:00Z");
    expect(time?.getAttribute("title")).toBeTruthy();

    const second = within(rows[1]);
    expect(second.getByText("3 of 3")).toBeTruthy();
    expect(second.queryByText(/in use/)).toBeNull();
    expect(rows[1].querySelector("time")).toBeNull();
  });

  it("scrolls the table inside its card", async () => {
    await renderLoaded();
    const container = screen.getByRole("table").closest("[data-slot=table-container]");
    expect(container?.className).toContain("overflow-x-auto");
  });

  it("says so when the cache is empty", async () => {
    await renderLoaded(status({ variants: [], leases: [], totals: { units: 0, files: 0, bytes: 0 } }));
    expect(screen.getByText("The spool cache is empty.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("counts the active leases and names the sims", async () => {
    await renderLoaded();
    expect(screen.getByText("Active leases: 1")).toBeTruthy();
    expect(screen.getByText("sim-abc")).toBeTruthy();
  });

  it("says no job holds anything when there are no leases", async () => {
    await renderLoaded(status({ leases: [] }));
    expect(screen.getByText("Active leases: 0")).toBeTruthy();
    expect(screen.getByText(/No running job is holding/)).toBeTruthy();
  });

  it("shows when it was checked, and Refresh reads it again", async () => {
    await renderLoaded();
    expect(screen.getByText(/Checked/).querySelector("time")?.getAttribute("dateTime")).toBe("2026-10-06T12:00:00Z");
    fetchAnvilScratch.mockResolvedValue({ ok: true, data: status({ checked_at: "2026-10-06T12:05:00Z" }) });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() =>
      expect(screen.getByText(/Checked/).querySelector("time")?.getAttribute("dateTime")).toBe("2026-10-06T12:05:00Z")
    );
    expect(fetchAnvilScratch).toHaveBeenCalledTimes(2);
  });
});

describe("when Anvil cannot answer", () => {
  it.each([
    [refused(503, "anvil_not_configured"), "Anvil isn't configured for this gateway."],
    [refused(503, "anvil_unreachable"), "Couldn't reach Anvil."],
    [refused(502, "spool_status_failed", "spool status exited 1"), "Anvil couldn't report on the spool cache."],
    [refused(403, "forbidden"), "Admins only."],
  ])("shows %# as an alert", async (failure, title) => {
    fetchAnvilScratch.mockResolvedValue(failure);
    render(<AnvilScratchCard />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(title);
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect((screen.getByRole("button", { name: "Clear spool cache" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the backend's message for a spool failure", async () => {
    fetchAnvilScratch.mockResolvedValue(refused(502, "spool_status_failed", "spool status exited 1"));
    render(<AnvilScratchCard />);
    expect((await screen.findByRole("alert")).textContent).toContain("spool status exited 1");
  });

  it("lets Refresh try again", async () => {
    fetchAnvilScratch.mockResolvedValueOnce(refused(503, "anvil_unreachable"));
    render(<AnvilScratchCard />);
    await screen.findByRole("alert");
    fetchAnvilScratch.mockResolvedValue({ ok: true, data: status() });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await screen.findByText("Scratch quota");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("clearing the spool cache", () => {
  it("asks for a dry run first, and states what would go and what stays", async () => {
    await renderLoaded();
    clearSpoolCache.mockResolvedValue({ ok: true, data: dryRun });
    fireEvent.click(screen.getByRole("button", { name: "Clear spool cache" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(clearSpoolCache).toHaveBeenCalledTimes(1);
    expect(clearSpoolCache).toHaveBeenCalledWith(true);
    const text = dialog.textContent ?? "";
    expect(text).toContain("13 years");
    expect(text).toContain("4,745 files");
    expect(text).toContain("2.0 GB");
    expect(text).toContain("2 years in use by running jobs are kept");
    expect(text).toContain("downloaded from S3 again, or rebuilt by the next simulation that needs them");
    expect(text).toContain("Nothing outside the spool cache is touched: simulation output and model inputs stay.");
  });

  it("deletes only on confirm: POST with dry_run false, then refreshes", async () => {
    await renderLoaded();
    clearSpoolCache
      .mockResolvedValueOnce({ ok: true, data: dryRun })
      .mockResolvedValueOnce({ ok: true, data: { ...dryRun, dry_run: false } });
    fetchAnvilScratch.mockResolvedValue({
      ok: true,
      data: status({ variants: [], leases: [], totals: { units: 0, files: 0, bytes: 0 } }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear spool cache" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear spool cache" }));
    await waitFor(() => expect(screen.getByText("The spool cache is empty.")).toBeTruthy());
    expect(clearSpoolCache.mock.calls).toEqual([[true], [false]]);
    expect(fetchAnvilScratch).toHaveBeenCalledTimes(2);
    expect(toast.success).toHaveBeenCalledWith("Spool cache cleared.");
    expect(screen.getByRole("status").textContent).toContain("Cleared 13 years (4,745 files, 2.0 GB)");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("sends nothing more on Cancel", async () => {
    await renderLoaded();
    clearSpoolCache.mockResolvedValue({ ok: true, data: dryRun });
    fireEvent.click(screen.getByRole("button", { name: "Clear spool cache" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(clearSpoolCache).toHaveBeenCalledTimes(1);
    expect(fetchAnvilScratch).toHaveBeenCalledTimes(1);
  });

  it("disables the buttons while the dry run is in flight", async () => {
    await renderLoaded();
    let answer: (value: unknown) => void = () => {};
    clearSpoolCache.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    fireEvent.click(screen.getByRole("button", { name: "Clear spool cache" }));
    const clear = await screen.findByRole("button", { name: "Checking…" });
    expect((clear as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Refresh" }) as HTMLButtonElement).disabled).toBe(true);
    answer({ ok: true, data: dryRun });
    await screen.findByRole("alertdialog");
  });

  it("disables the dialog's buttons while the delete is in flight", async () => {
    await renderLoaded();
    let answer: (value: unknown) => void = () => {};
    clearSpoolCache
      .mockResolvedValueOnce({ ok: true, data: dryRun })
      .mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    fireEvent.click(screen.getByRole("button", { name: "Clear spool cache" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear spool cache" }));
    const pending = await within(dialog).findByRole("button", { name: "Clearing…" });
    expect((pending as HTMLButtonElement).disabled).toBe(true);
    expect((within(dialog).getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    // The page's own buttons stay disabled behind it.
    expect((screen.getByRole("button", { name: "Refresh", hidden: true }) as HTMLButtonElement).disabled).toBe(true);
    answer({ ok: true, data: { ...dryRun, dry_run: false } });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("shows a failed dry run as an alert and a toast, without a dialog", async () => {
    await renderLoaded();
    clearSpoolCache.mockResolvedValue(refused(503, "anvil_unreachable"));
    fireEvent.click(screen.getByRole("button", { name: "Clear spool cache" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't reach Anvil."));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect((await screen.findByRole("alert")).textContent).toContain("Couldn't reach Anvil.");
    expect(clearSpoolCache).toHaveBeenCalledTimes(1);
  });

  it("keeps the dialog open with the reason when the delete fails", async () => {
    await renderLoaded();
    clearSpoolCache
      .mockResolvedValueOnce({ ok: true, data: dryRun })
      .mockResolvedValueOnce(refused(502, "spool_clear_failed", "rm failed on global/era5"));
    fireEvent.click(screen.getByRole("button", { name: "Clear spool cache" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear spool cache" }));
    await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toContain("rm failed on global/era5"));
    expect(toast.error).toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(fetchAnvilScratch).toHaveBeenCalledTimes(1);
  });

  it("says there is nothing to clear instead of opening an empty dialog", async () => {
    await renderLoaded();
    clearSpoolCache.mockResolvedValue({
      ok: true,
      data: { ...dryRun, deleted_units: 0, deleted_files: 0, deleted_bytes: 0, deleted: [] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear spool cache" }));
    await waitFor(() => expect(toast.info).toHaveBeenCalled());
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
