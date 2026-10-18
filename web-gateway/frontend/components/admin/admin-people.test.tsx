import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { Job } from "@/lib/jobs/types";
import type { AuditLogEntry, UserLabels } from "@/lib/admin/types";

import { AdminJobsTable } from "@/components/admin/admin-jobs-table";
import { AuditLogTable } from "@/components/admin/audit-log-table";

afterEach(cleanup);

const people: UserLabels = {
  u1: { id: "u1", name: "Ada Lovelace", email: "ada@example.edu" },
  u2: { id: "u2", name: "Grace Hopper", email: "grace@example.edu" },
};

const job = (over: Record<string, unknown> = {}) =>
  ({
    id: "j1", sim_id: "sim-1", user_id: "u1", dataset_title: "Snapshot A", status: "COMPLETED", slurm_job_id: "1",
    created_at: "2026-09-30T19:04:00Z", submitted_at: "2026-10-01T08:00:00Z", cancel_requested_at: null, ...over,
  }) as unknown as Job;

const entry = (over: Partial<AuditLogEntry> = {}): AuditLogEntry => ({
  id: "a1", action: "user_admin_updated", category: "auth", actor_id: "u1", actor_email: "ada@example.edu",
  target_id: "u2", detail: null, created_at: "2026-09-30T19:04:00Z", ...over,
});

describe("the simulations table", () => {
  it("names the owner by name and email, linked to their page", () => {
    render(<AdminJobsTable jobs={[job()]} owners={people} />);
    const link = screen.getByRole("link", { name: "Ada Lovelace" });
    expect(link.getAttribute("href")).toBe("/admin/users/u1");
    expect(screen.getByText("ada@example.edu")).toBeTruthy();
    expect(screen.queryByText("u1")).toBeNull();
  });

  it("shows the id of an owner it cannot find", () => {
    render(<AdminJobsTable jobs={[job({ user_id: "gone" })]} owners={people} />);
    expect(screen.getByText("gone")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "gone" })).toBeNull();
  });

  it("calls its columns Run ID, Owner, Snapshot, Status, Slurm ID and Submitted", () => {
    render(<AdminJobsTable jobs={[job()]} owners={people} />);
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Run ID", "Owner", "Snapshot", "Status", "Slurm ID", "Submitted"]);
  });
});

describe("the audit log's people", () => {
  it("names the actor and a user who is the target, and links both", () => {
    render(<AuditLogTable entries={[entry()]} people={people} />);
    const row = screen.getAllByRole("row")[1];
    expect(within(row).getByRole("link", { name: "Ada Lovelace" }).getAttribute("href")).toBe("/admin/users/u1");
    expect(within(row).getByRole("link", { name: "Grace Hopper" }).getAttribute("href")).toBe("/admin/users/u2");
  });

  it("falls back to the email the event recorded, then to the id", () => {
    render(
      <AuditLogTable
        entries={[entry({ actor_id: "gone", actor_email: "old@example.edu", target_id: "job-17" })]}
        people={{}}
        showFilters={false}
      />
    );
    expect(screen.getByText("old@example.edu")).toBeTruthy();
    expect(screen.getByText("job-17")).toBeTruthy();
  });

  it("calls the background sweep System", () => {
    render(<AuditLogTable entries={[entry({ actor_id: "system", actor_email: null, target_id: null })]} people={{}} />);
    expect(within(screen.getAllByRole("row")[1]).getByText("System")).toBeTruthy();
  });

  it("offers to show only one actor's events, keeping the other filters", () => {
    render(<AuditLogTable entries={[entry()]} people={people} filters={{ category: "auth", date_from: "2026-10-01" }} />);
    const link = screen.getByRole("link", { name: "Show only events by Ada Lovelace" });
    expect(link.getAttribute("href")).toBe("/admin/audit?category=auth&actor_id=u1&date_from=2026-10-01");
  });

  it("has no such link where the filters are hidden", () => {
    render(<AuditLogTable entries={[entry()]} people={people} showFilters={false} />);
    expect(screen.queryByRole("link", { name: /Show only events by/ })).toBeNull();
  });
});

describe("the audit log's detail", () => {
  it("reads as key: value pairs", () => {
    render(<AuditLogTable entries={[entry({ detail: { from: "RUNNING", to: "COMPLETED" } })]} people={people} />);
    expect(screen.getByText("from: RUNNING · to: COMPLETED")).toBeTruthy();
    expect(screen.queryByText("Show all")).toBeNull();
  });

  it("opens to the full JSON when it is long or nested", () => {
    const detail = { removed: { paths: ["/a", "/b"] }, note: "n" };
    const { container } = render(<AuditLogTable entries={[entry({ detail })]} people={people} />);
    expect(screen.getByText("Show all")).toBeTruthy();
    const pre = container.querySelector("details pre");
    expect(JSON.parse(pre?.textContent ?? "")).toEqual(detail);
  });

  it("is a dash when there is none", () => {
    render(<AuditLogTable entries={[entry({ detail: null })]} people={people} />);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});

describe("the audit log's filters", () => {
  it("wrap the category pills so they do not run off a phone", () => {
    render(<AuditLogTable entries={[]} />);
    expect(screen.getByRole("link", { name: "All" }).parentElement?.className).toContain("flex-wrap");
  });

  it("keep the actor and the days when the category changes", () => {
    render(<AuditLogTable entries={[]} filters={{ actor_id: "u1", date_from: "2026-10-01", date_to: "2026-10-03" }} />);
    expect(screen.getByRole("link", { name: "Jobs" }).getAttribute("href")).toBe(
      "/admin/audit?category=job&actor_id=u1&date_from=2026-10-01&date_to=2026-10-03"
    );
  });

  it("have a day range form that submits to the page and keeps category and actor", () => {
    const { container } = render(
      <AuditLogTable entries={[]} filters={{ category: "job", actor_id: "u1", date_from: "2026-10-01" }} />
    );
    const form = container.querySelector("form")!;
    expect(form.getAttribute("method")).toBe("get");
    expect(form.getAttribute("action")).toBe("/admin/audit");
    expect((screen.getByLabelText("From") as HTMLInputElement).value).toBe("2026-10-01");
    expect((screen.getByLabelText("From") as HTMLInputElement).type).toBe("date");
    expect((screen.getByLabelText("To") as HTMLInputElement).name).toBe("date_to");
    expect((form.querySelector('input[name="category"]') as HTMLInputElement).value).toBe("job");
    expect((form.querySelector('input[name="actor_id"]') as HTMLInputElement).value).toBe("u1");
    expect(screen.getByRole("link", { name: "Clear dates" }).getAttribute("href")).toBe(
      "/admin/audit?category=job&actor_id=u1"
    );
  });

  it("have no day range form where the filters are hidden, and say when a filter matched nothing", () => {
    const { container, rerender } = render(<AuditLogTable entries={[]} showFilters={false} />);
    expect(container.querySelector("form")).toBeNull();
    expect(screen.getByText(/Sign-ins and job activity/)).toBeTruthy();
    rerender(<AuditLogTable entries={[]} filters={{ actor_id: "u1" }} />);
    expect(screen.getByText(/Nothing matches these filters/)).toBeTruthy();
  });
});
