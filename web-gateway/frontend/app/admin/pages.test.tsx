import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
  fetchUsers: vi.fn(),
  fetchUserDetail: vi.fn(),
  fetchUserSessions: vi.fn(),
  fetchAuditLog: vi.fn(),
  fetchUserLabels: vi.fn(),
  fetchSystemInfo: vi.fn(),
  fetchJobs: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: m.auth }));
vi.mock("next/navigation", () => ({
  redirect: m.redirect,
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/admin/actions", () => ({
  fetchUsers: m.fetchUsers,
  fetchUserDetail: m.fetchUserDetail,
  fetchUserSessions: m.fetchUserSessions,
  fetchAuditLog: m.fetchAuditLog,
  fetchUserLabels: m.fetchUserLabels,
  fetchSystemInfo: m.fetchSystemInfo,
}));
vi.mock("@/lib/jobs/actions", () => ({ fetchJobs: m.fetchJobs }));
vi.mock("@/components/admin/anvil-scratch-card", () => ({ AnvilScratchCard: () => <div>scratch card</div> }));
vi.mock("@/components/admin/user-role-status-card", () => ({ UserRoleStatusCard: () => <div>role card</div> }));
vi.mock("@/components/admin/user-sessions-table", () => ({ UserSessionsTable: () => <div>sessions</div> }));
vi.mock("@/components/admin/users-table", () => ({ UsersTable: () => <div>users table</div> }));

import AdminUsersPage, { metadata as usersMeta } from "@/app/admin/users/page";
import AdminJobsPage, { metadata as jobsMeta } from "@/app/admin/jobs/page";
import AdminAuditPage, { metadata as auditMeta } from "@/app/admin/audit/page";
import AdminUserDetailPage, { metadata as detailMeta } from "@/app/admin/users/[id]/page";
import AdminSystemPage, { metadata as systemMeta } from "@/app/admin/system/page";

const unauthorized = Object.assign(new Error("401"), { response: { status: 401 } });
const broken = Object.assign(new Error("500"), { response: { status: 500 } });
const page = { items: [], total_count: 0, page: 1, total_pages: 1 };
const ada = { id: "u1", name: "Ada Lovelace", email: "ada@example.edu" };

beforeEach(() => {
  m.auth.mockResolvedValue({ user: { id: "root", role: "admin" } });
  m.fetchUsers.mockResolvedValue(page);
  m.fetchAuditLog.mockResolvedValue(page);
  m.fetchJobs.mockResolvedValue(page);
  m.fetchUserLabels.mockResolvedValue({});
  m.fetchUserSessions.mockResolvedValue({ items: [] });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const q = (o: Record<string, string> = {}) => Promise.resolve(o);

describe("an expired session on an admin list", () => {
  it("sends the users page to sign in, back to the same page and filters", async () => {
    m.fetchUsers.mockRejectedValue(unauthorized);
    await expect(AdminUsersPage({ searchParams: q({ page: "3", q: "ada" }) })).rejects.toThrow(
      "redirect:/auth/signin?callbackUrl=%2Fadmin%2Fusers%3Fpage%3D3%26q%3Dada"
    );
  });

  it("sends the simulations page to sign in", async () => {
    m.fetchJobs.mockRejectedValue(unauthorized);
    await expect(AdminJobsPage({ searchParams: q({ status: "RUNNING" }) })).rejects.toThrow(
      "redirect:/auth/signin?callbackUrl=%2Fadmin%2Fjobs%3Fstatus%3DRUNNING"
    );
  });

  it("sends the audit log to sign in", async () => {
    m.fetchAuditLog.mockRejectedValue(unauthorized);
    await expect(AdminAuditPage({ searchParams: q({ actor_id: "u1" }) })).rejects.toThrow(
      "redirect:/auth/signin?callbackUrl=%2Fadmin%2Faudit%3Factor_id%3Du1"
    );
  });

  it("still says Couldn't load for any other failure", async () => {
    m.fetchUsers.mockRejectedValue(broken);
    m.fetchJobs.mockRejectedValue(broken);
    m.fetchAuditLog.mockRejectedValue(broken);
    render(await AdminUsersPage({ searchParams: q() }));
    expect(screen.getByText("Couldn't load users.")).toBeTruthy();
    cleanup();
    render(await AdminJobsPage({ searchParams: q() }));
    expect(screen.getByText("Couldn't load simulations.")).toBeTruthy();
    cleanup();
    render(await AdminAuditPage({ searchParams: q() }));
    expect(screen.getByText("Couldn't load the audit log.")).toBeTruthy();
    expect(m.redirect).not.toHaveBeenCalled();
  });
});

describe("the simulations page", () => {
  const job = { id: "j1", sim_id: "sim-1", user_id: "u1", dataset_title: "Snapshot A", status: "DRAFT", slurm_job_id: null, created_at: "2026-09-30T19:04:00Z", submitted_at: null };

  it("is titled Simulations and names each owner from one lookup", async () => {
    m.fetchJobs.mockResolvedValue({ ...page, items: [job, { ...job, id: "j2", sim_id: "sim-2" }], total_count: 2 });
    m.fetchUserLabels.mockResolvedValue({ u1: ada });
    render(await AdminJobsPage({ searchParams: q() }));
    expect(screen.getByRole("heading", { level: 1, name: "Simulations" })).toBeTruthy();
    expect(m.fetchUserLabels).toHaveBeenCalledTimes(1);
    expect(m.fetchUserLabels.mock.calls[0][0]).toEqual(["u1", "u1"]);
    expect(screen.getAllByRole("link", { name: "Ada Lovelace" }).length).toBe(2);
    expect(jobsMeta.title).toBe("Simulations | OpenGHM Admin");
  });

  it("shows the filtered user as a name and email, not an id", async () => {
    m.fetchUserLabels.mockResolvedValue({ u1: ada });
    render(await AdminJobsPage({ searchParams: q({ user_id: "u1" }) }));
    expect(m.fetchJobs).toHaveBeenCalledWith(1, undefined, "u1");
    expect(screen.getByText(/Filtered to user/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ada Lovelace" }).getAttribute("href")).toBe("/admin/users/u1");
    expect(screen.getByText("ada@example.edu")).toBeTruthy();
    expect(screen.queryByText("u1")).toBeNull();
  });
});

describe("the audit log page", () => {
  it("passes the actor, the category and the days to the backend", async () => {
    render(
      await AdminAuditPage({
        searchParams: q({ page: "2", category: "job", actor_id: "u1", date_from: "2026-10-01", date_to: "2026-10-03" }),
      })
    );
    expect(m.fetchAuditLog).toHaveBeenCalledWith(2, {
      category: "job", actor_id: "u1", date_from: "2026-10-01", date_to: "2026-10-03",
    });
  });

  it("ignores a day that is not one, instead of failing on the backend's 422", async () => {
    render(await AdminAuditPage({ searchParams: q({ date_from: "tomorrow", date_to: "" }) }));
    expect(m.fetchAuditLog).toHaveBeenCalledWith(1, {
      category: undefined, actor_id: undefined, date_from: undefined, date_to: undefined,
    });
  });

  it("names the actor the log is narrowed to, with a way to clear it", async () => {
    m.fetchUserLabels.mockResolvedValue({ u1: ada });
    render(await AdminAuditPage({ searchParams: q({ actor_id: "u1", category: "job" }) }));
    expect(screen.getByText(/Events by/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Clear" }).getAttribute("href")).toBe("/admin/audit?category=job");
  });

  it("names the actors and targets of the events in one lookup", async () => {
    m.fetchAuditLog.mockResolvedValue({
      ...page,
      items: [
        { id: "a1", action: "job_submitted", category: "job", actor_id: "u1", actor_email: null, target_id: "job-9", detail: null, created_at: "2026-09-30T19:04:00Z" },
      ],
      total_count: 1,
    });
    m.fetchUserLabels.mockResolvedValue({ u1: ada });
    render(await AdminAuditPage({ searchParams: q() }));
    expect(m.fetchUserLabels).toHaveBeenCalledTimes(1);
    expect(m.fetchUserLabels.mock.calls[0][0]).toEqual(["u1", "job-9"]);
    expect(screen.getByRole("link", { name: "Ada Lovelace" })).toBeTruthy();
  });
});

describe("a user's page", () => {
  const user = { id: "u1", name: "Ada Lovelace", email: "ada@example.edu", job_counts: {} };
  const job = { id: "j1", sim_id: "sim-1", user_id: "u1", dataset_title: "Snapshot A", status: "DRAFT", slurm_job_id: null, created_at: "2026-09-30T19:04:00Z", submitted_at: null };

  it("asks the backend for this user's own events, not the site's first page", async () => {
    m.fetchUserDetail.mockResolvedValue(user);
    m.fetchAuditLog.mockResolvedValue({
      ...page,
      items: [{ id: "a1", action: "job_submitted", category: "job", actor_id: "u1", actor_email: null, target_id: null, detail: null, created_at: "2026-09-30T19:04:00Z" }],
      total_count: 1,
    });
    render(await AdminUserDetailPage({ params: Promise.resolve({ id: "u1" }) }));
    expect(m.fetchAuditLog).toHaveBeenCalledWith(1, { actor_id: "u1" }, 5);
    expect(screen.getByText("job_submitted")).toBeTruthy();
    expect(screen.queryByText("No events to show.")).toBeNull();
    const viewAll = screen.getAllByRole("link", { name: "View all" }).map((a) => a.getAttribute("href"));
    expect(viewAll).toContain("/admin/audit?actor_id=u1");
  });

  it("links Recent jobs to all of that user's simulations", async () => {
    m.fetchUserDetail.mockResolvedValue(user);
    m.fetchJobs.mockResolvedValue({ ...page, items: [job], total_count: 1 });
    render(await AdminUserDetailPage({ params: Promise.resolve({ id: "u1" }) }));
    const viewAll = screen.getAllByRole("link", { name: "View all" }).map((a) => a.getAttribute("href"));
    expect(viewAll).toContain("/admin/jobs?user_id=u1");
  });

  it("sends an expired session to sign in", async () => {
    m.fetchUserDetail.mockResolvedValue(user);
    m.fetchAuditLog.mockRejectedValue(unauthorized);
    await expect(AdminUserDetailPage({ params: Promise.resolve({ id: "u1" }) })).rejects.toThrow(
      "redirect:/auth/signin?callbackUrl=%2Fadmin%2Fusers%2Fu1"
    );
  });
});

describe("the system page", () => {
  it("tells staff it is for administrators, without asking the backend", async () => {
    m.auth.mockResolvedValue({ user: { id: "s", role: "staff" } });
    render(await AdminSystemPage());
    expect(screen.getByText("This page is for administrators.")).toBeTruthy();
    expect(screen.queryByText(/Couldn't load/)).toBeNull();
    expect(m.fetchSystemInfo).not.toHaveBeenCalled();
  });

  it("still says it could not load for an admin when the backend fails", async () => {
    m.fetchSystemInfo.mockResolvedValue(null);
    render(await AdminSystemPage());
    expect(screen.getByText("Couldn't load the system information.")).toBeTruthy();
  });
});

describe("the document titles", () => {
  it("name the page and the console", () => {
    expect(usersMeta.title).toBe("Users | OpenGHM Admin");
    expect(auditMeta.title).toBe("Audit log | OpenGHM Admin");
    expect(detailMeta.title).toBe("User | OpenGHM Admin");
    expect(systemMeta.title).toBe("System | OpenGHM Admin");
  });
});
