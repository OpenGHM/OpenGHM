import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Job } from "@/lib/jobs/types";
import type { AdminUser, AdminUserDetail, AuditLogEntry } from "@/lib/admin/types";
import type { SessionEntry } from "@/lib/account/types";

vi.mock("@/lib/admin/actions", () => ({
  updateUser: vi.fn(),
  revokeUserSession: vi.fn(),
  revokeAllUserSessions: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/admin",
  useSearchParams: () => new URLSearchParams(),
}));

import { AdminJobsTable } from "@/components/admin/admin-jobs-table";
import { AuditLogTable } from "@/components/admin/audit-log-table";
import { UserRoleStatusCard } from "@/components/admin/user-role-status-card";
import { UserSessionsTable } from "@/components/admin/user-sessions-table";
import { UsersTable } from "@/components/admin/users-table";
import { DraftCard } from "@/components/jobs/draft-card";

afterEach(cleanup);

const WHEN = "2026-09-30T19:04:00Z";

/** Every `<time>` on the page, by its machine-readable value. */
function times(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("time")).map((t) => t.getAttribute("datetime") ?? "");
}

const user: AdminUser = {
  id: "u1",
  email: "ada@example.edu",
  name: "Ada Lovelace",
  role: "user",
  organization: "Purdue",
  email_verified: true,
  is_active: true,
  can_run_simulations: true,
  created_at: WHEN,
};

describe("dates in the admin pages are <time> elements", () => {
  it("the users table prints Joined as a date", () => {
    const { container } = render(<UsersTable users={[user]} currentUserId="x" canManage />);
    expect(times(container)).toEqual([WHEN]);
    // The first render is UTC on the server and in the browser's hydration.
    expect(container.querySelector("time")?.textContent).toMatch(/2026/);
  });

  it("the jobs table prints Submitted, and for a never-submitted draft says so with its creation time", () => {
    const job = {
      id: "j1",
      sim_id: "sim-1",
      user_id: "u1",
      dataset_title: "Dataset",
      status: "COMPLETED",
      slurm_job_id: "123",
      created_at: WHEN,
      submitted_at: "2026-10-01T08:00:00Z",
      cancel_requested_at: null,
    } as unknown as Job;
    const { container, rerender } = render(<AdminJobsTable jobs={[job]} />);
    expect(times(container)).toEqual(["2026-10-01T08:00:00Z"]);
    expect(screen.queryByText(/Not submitted/)).toBeNull();

    rerender(<AdminJobsTable jobs={[{ ...job, status: "DRAFT", submitted_at: null }]} />);
    expect(screen.getByText(/Not submitted/)).toBeTruthy();
    expect(times(container)).toEqual([WHEN]);
  });

  it("the audit log prints When, with the absolute time", () => {
    const entry: AuditLogEntry = {
      id: "a1",
      action: "login",
      category: "auth",
      actor_id: "u1",
      actor_email: "ada@example.edu",
      target_id: null,
      detail: null,
      created_at: WHEN,
    };
    const { container } = render(<AuditLogTable entries={[entry]} />);
    expect(times(container)).toEqual([WHEN]);
    // Printed in the viewer's zone, so the day depends on where the test runs.
    expect(container.querySelector("time")?.textContent).toMatch(/2026/);
  });

  it("the profile card prints Member since and Last login", () => {
    const detail: AdminUserDetail = {
      ...user,
      updated_at: null,
      sso_provider: null,
      sso_email: null,
      has_password: true,
      active_session_count: 1,
      job_counts: {},
      last_login_at: "2026-09-29T08:00:00Z",
    };
    const { container } = render(<UserRoleStatusCard user={detail} isSelf={false} canManage />);
    expect(times(container)).toEqual([WHEN, "2026-09-29T08:00:00Z"]);
  });

  it("the profile card names CILogon and the address it gave when it is connected", () => {
    const detail = {
      ...user,
      updated_at: null,
      sso_provider: "cilogon",
      sso_email: "ada@purdue.edu",
      has_password: false,
      active_session_count: 0,
      job_counts: {},
      last_login_at: null,
    } as AdminUserDetail;
    render(<UserRoleStatusCard user={detail} isSelf={false} canManage />);
    expect(screen.getByText("Sign-in method")).toBeTruthy();
    expect(screen.getByText("CILogon")).toBeTruthy();
    expect(screen.getByText("ada@purdue.edu")).toBeTruthy();
  });

  it("the profile card has no sign-in method row without a connected identity", () => {
    const detail = {
      ...user,
      updated_at: null,
      sso_provider: null,
      sso_email: null,
      has_password: true,
      active_session_count: 0,
      job_counts: {},
      last_login_at: null,
    } as AdminUserDetail;
    render(<UserRoleStatusCard user={detail} isSelf={false} canManage />);
    expect(screen.queryByText("Sign-in method")).toBeNull();
  });

  it("the profile card says Never when there is no login", () => {
    const detail = {
      ...user,
      updated_at: null,
      sso_provider: null,
      sso_email: null,
      has_password: true,
      active_session_count: 0,
      job_counts: {},
      last_login_at: null,
    } as AdminUserDetail;
    render(<UserRoleStatusCard user={detail} isSelf={false} canManage />);
    expect(screen.getByText("Never")).toBeTruthy();
  });

  it("the sessions list prints Last used", () => {
    const session: SessionEntry = {
      id: "s1",
      created_at: WHEN,
      last_used_at: WHEN,
      user_agent: "Firefox on Linux",
      current: false,
    };
    const { container } = render(<UserSessionsTable userId="u1" sessions={[session]} />);
    expect(times(container)).toEqual([WHEN]);
    expect(container.textContent).toContain("Last used");
  });

  it("the snapshot draft card on a user's page prints the date", () => {
    const job = {
      id: "j1",
      sim_id: "sim-1",
      dataset_title: "Dataset",
      status: "COMPLETED",
      slurm_job_id: null,
      created_at: WHEN,
      started_at: null,
      completed_at: null,
      cancel_requested_at: null,
    } as unknown as Job;
    const { container } = render(<DraftCard job={job} />);
    expect(times(container)).toEqual([WHEN]);
  });
});

describe("the sessions list", () => {
  const session: SessionEntry = {
    id: "s1",
    created_at: WHEN,
    last_used_at: WHEN,
    user_agent: "Firefox on Linux",
    current: false,
  };

  it("opens a dialog instead of window.confirm", async () => {
    const confirm = vi.spyOn(window, "confirm");
    render(<UserSessionsTable userId="u1" sessions={[session]} />);
    screen.getByRole("button", { name: "Sign out Firefox on Linux" }).click();
    expect(await screen.findByText("Sign this device out?")).toBeTruthy();
    expect(confirm).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("shows a dashed empty state with no sessions", () => {
    render(<UserSessionsTable userId="u1" sessions={[]} />);
    expect(screen.getByText("No active sessions.")).toBeTruthy();
  });
});

describe("the empty states", () => {
  it("users, jobs and audit say what is missing", () => {
    render(
      <>
        <UsersTable users={[]} currentUserId="x" canManage />
        <AdminJobsTable jobs={[]} />
        <AuditLogTable entries={[]} />
      </>
    );
    expect(screen.getByText("No users match these filters.")).toBeTruthy();
    expect(screen.getByText("No simulations match these filters.")).toBeTruthy();
    expect(screen.getByText("No events to show.")).toBeTruthy();
  });
});

describe("a user with many sessions", () => {
  const many: SessionEntry[] = Array.from({ length: 25 }, (_, i) => ({
    id: `s${i}`,
    created_at: WHEN,
    // s24 is the most recently used, s0 the oldest.
    last_used_at: new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString(),
    user_agent: `Device ${i}`,
    current: false,
  }));

  it("shows the 10 most recently used, with a button for the rest", () => {
    render(<UserSessionsTable userId="u1" sessions={many} />);
    expect(screen.getByText("Sessions (25)")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Sign out Device/ })).toHaveLength(10);
    expect(screen.getByText("Device 24")).toBeTruthy();
    expect(screen.getByText("Device 15")).toBeTruthy();
    expect(screen.queryByText("Device 14")).toBeNull();
    expect(screen.getByRole("button", { name: "Sign out all devices" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show all 25 sessions" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("expands in place and collapses again", () => {
    render(<UserSessionsTable userId="u1" sessions={many} />);
    fireEvent.click(screen.getByRole("button", { name: "Show all 25 sessions" }));
    expect(screen.getAllByRole("button", { name: /^Sign out Device/ })).toHaveLength(25);
    fireEvent.click(screen.getByRole("button", { name: "Show only the 10 most recent" }));
    expect(screen.getAllByRole("button", { name: /^Sign out Device/ })).toHaveLength(10);
  });

  it("has no Show all button for 10 sessions or fewer", () => {
    render(<UserSessionsTable userId="u1" sessions={many.slice(0, 10)} />);
    expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
  });
});
