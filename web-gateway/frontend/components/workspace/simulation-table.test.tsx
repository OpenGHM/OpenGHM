import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Job } from "@/lib/jobs/types";

vi.mock("@/lib/jobs/actions", () => ({ cancelJob: vi.fn(), deleteSimulation: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/workspace",
}));

import { SimulationTable } from "@/components/workspace/simulation-table";

afterEach(cleanup);

function job(id: string, status: Job["status"], over: Partial<Job> = {}): Job {
  return {
    id,
    sim_id: `sim-${id}`,
    dataset_id: "ds-1",
    dataset_title: "Dataset one",
    slug: null,
    about: { name: `Run ${id}` },
    status,
    created_at: "2026-09-30T10:00:00Z",
    updated_at: "2026-09-30T12:00:00Z",
    cancel_requested_at: null,
    work_dir: null,
    remote_job_dir: null,
    files: null,
    ...over,
  } as Job;
}

describe("the simulation table", () => {
  it("has the five columns, the last one for the delete button", () => {
    render(<SimulationTable jobs={[job("a", "RUNNING")]} />);
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Name", "Status", "Based on", "Updated", "Actions",
    ]);
  });

  it("links the name to the simulation and the snapshot to the repository", () => {
    render(<SimulationTable jobs={[job("a", "RUNNING")]} />);
    const row = within(screen.getByRole("table")).getAllByRole("row")[1];
    expect(within(row).getByRole("link", { name: "Run a" }).getAttribute("href")).toBe("/workspace/a");
    expect(within(row).getByRole("link", { name: "Dataset one" }).getAttribute("href")).toBe("/repository/ds-1");
  });

  it("labels what a simulation is based on with the kind badge, before the title", () => {
    render(<SimulationTable jobs={[job("a", "RUNNING")]} />);
    const cell = within(screen.getByRole("table")).getByRole("link", { name: "Dataset one" }).parentElement!;
    expect(within(cell).getByText("Model Snapshot")).toBeTruthy();
    expect(cell.firstElementChild?.textContent).toBe("Model Snapshot");
    const list = within(screen.getByRole("list", { name: "Simulations" }));
    expect(list.getByText("Model Snapshot")).toBeTruthy();
  });

  it("truncates a long title in the cell rather than growing the row", () => {
    render(<SimulationTable jobs={[job("a", "RUNNING", { dataset_title: "A very long title ".repeat(10) })]} />);
    const link = within(screen.getByRole("table")).getByRole("link", { name: /A very long title/ });
    expect(link.className).toContain("truncate");
    expect(link.className).toContain("min-w-0");
  });

  it("prints the update time as a TimeStamp with its absolute time, not toLocaleString", () => {
    render(<SimulationTable jobs={[job("a", "RUNNING")]} />);
    const row = within(screen.getByRole("table")).getAllByRole("row")[1];
    const time = row.querySelector("time");
    expect(time?.getAttribute("datetime")).toBe("2026-09-30T12:00:00Z");
    expect(time?.getAttribute("title")).toBeTruthy();
  });

  it("falls back to the creation time for a job that has never been updated", () => {
    render(<SimulationTable jobs={[job("a", "DRAFT", { updated_at: null })]} />);
    const row = within(screen.getByRole("table")).getAllByRole("row")[1];
    expect(row.querySelector("time")?.getAttribute("datetime")).toBe("2026-09-30T10:00:00Z");
  });

  it("also renders stacked rows for a phone: name, status, snapshot, time and delete button per row", () => {
    render(
      <SimulationTable
        jobs={[job("a", "RUNNING"), job("b", "DRAFT", { cancel_requested_at: null })]}
      />
    );
    const list = screen.getByRole("list", { name: "Simulations" });
    // The table is hidden below sm and the list from sm up, by CSS.
    expect(list.className).toContain("sm:hidden");
    expect(screen.getByRole("table").closest("div.hidden")?.className).toContain("sm:block");

    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    const first = within(rows[0]);
    expect(first.getByRole("link", { name: "Run a" }).getAttribute("href")).toBe("/workspace/a");
    expect(first.getByText("Running")).toBeTruthy();
    expect(first.getByRole("link", { name: "Dataset one" }).getAttribute("href")).toBe("/repository/ds-1");
    expect(first.getByText(/^Updated/)).toBeTruthy();
    // A running job has no delete button; a draft has.
    expect(first.queryByRole("button")).toBeNull();
    expect(within(rows[1]).getByText("Draft")).toBeTruthy();
    expect(within(rows[1]).getByRole("button", { name: "Delete draft Run b" })).toBeTruthy();
  });

  it("gives each stacked-row link a 40 px target", () => {
    render(<SimulationTable jobs={[job("a", "COMPLETED")]} />);
    const list = within(screen.getByRole("list", { name: "Simulations" }));
    expect(list.getByRole("link", { name: "Run a" }).className).toContain("py-2.5");
    expect(list.getByRole("link", { name: "Dataset one" }).className).toContain("py-2.5");
    expect(list.getByRole("button", { name: "Delete Run a" }).className).toContain("size-10");
  });

  it("names an untitled job by its slug, then its sim id", () => {
    render(
      <SimulationTable
        jobs={[job("a", "DRAFT", { about: null, slug: "my-slug" }), job("b", "DRAFT", { about: null })]}
      />
    );
    const table = within(screen.getByRole("table"));
    expect(table.getByRole("link", { name: "my-slug" })).toBeTruthy();
    expect(table.getByRole("link", { name: "sim-b" })).toBeTruthy();
  });

  it("offers Delete on a draft and an ended job in the table, never on an active one", () => {
    render(
      <SimulationTable
        jobs={[job("a", "RUNNING"), job("b", "DRAFT"), job("c", "FAILED"), job("d", "COMPLETING")]}
      />
    );
    const table = within(screen.getByRole("table"));
    expect(table.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Delete draft Run b",
      "Delete Run c",
    ]);
  });

  it("opens the delete confirmation from a row's button without navigating", () => {
    render(<SimulationTable jobs={[job("a", "COMPLETED")]} />);
    const table = within(screen.getByRole("table"));
    fireEvent.click(table.getByRole("button", { name: "Delete Run a" }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(screen.getByText("Delete this simulation?")).toBeTruthy();
  });
});
