import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const { reorderTutorials, toast, refresh } = vi.hoisted(() => ({
  reorderTutorials: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  refresh: vi.fn(),
}));
vi.mock("@/lib/community/admin-actions", () => ({ reorderTutorials }));
vi.mock("sonner", () => ({ toast }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/admin/community/workshops/w1",
}));

import { AdminRoleProvider, AdminNav } from "@/components/admin/admin-nav";
import { AuditLogTable } from "@/components/admin/audit-log-table";
import { CommunitySubNav } from "@/components/admin/community/community-sub-nav";
import { InterestTable, emailList } from "@/components/admin/community/interest-table";
import { TutorialList } from "@/components/admin/community/tutorial-list";
import { WorkshopList } from "@/components/admin/community/workshop-list";
import type { GroupInterest, Tutorial, Workshop } from "@/lib/community/types";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const meta = { created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-02T00:00:00Z", updated_by: "u1" };

const workshop = (over: Partial<Workshop>): Workshop => ({
  id: "w1",
  state: "published",
  status: "upcoming",
  slug: "first",
  title: "First workshop",
  summary: "",
  date: "2027-02-15",
  end_date: "2027-03-31",
  when_label: null,
  format: null,
  location: null,
  cover: null,
  signup: null,
  details: [],
  photos: [],
  materials: [],
  body: null,
  ...meta,
  ...over,
});

const tutorial = (over: Partial<Tutorial>): Tutorial => ({
  id: "t1",
  state: "published",
  slug: "one",
  title: "Tutorial one",
  summary: "",
  kind: "gateway",
  minutes: 20,
  level: "beginner",
  snippet: "",
  action_label: null,
  url: null,
  body: null,
  position: 0,
  ...meta,
  ...over,
});

describe("the workshop list", () => {
  it("shows title, dates, status and state, each title a link to its editor", () => {
    const { container } = render(
      <WorkshopList
        workshops={[
          workshop({}),
          workshop({ id: "w2", title: "Old workshop", slug: "old", status: "past", state: "draft", end_date: null, date: "2024-12-10" }),
        ]}
      />
    );
    const link = screen.getByRole("link", { name: "First workshop" });
    expect(link.getAttribute("href")).toBe("/admin/community/workshops/w1");
    expect(screen.getByText("Upcoming")).toBeTruthy();
    expect(screen.getByText("Past")).toBeTruthy();
    expect(screen.getByText("Published")).toBeTruthy();
    expect(screen.getByText("Draft")).toBeTruthy();
    // A range prints both days; a single day prints one.
    const days = Array.from(container.querySelectorAll("time[datetime]"))
      .map((t) => t.getAttribute("datetime"))
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d ?? ""));
    expect(days).toEqual(["2027-02-15", "2027-03-31", "2024-12-10"]);
  });

  it("says what to do when there are none", () => {
    render(<WorkshopList workshops={[]} />);
    expect(screen.getByText("No workshops yet.")).toBeTruthy();
    expect(screen.getByText(/New workshop/)).toBeTruthy();
  });
});

describe("the tutorial list", () => {
  const three = [
    tutorial({ id: "a", title: "Alpha", slug: "alpha" }),
    tutorial({ id: "b", title: "Beta", slug: "beta", kind: "video", level: "advanced", minutes: null }),
    tutorial({ id: "c", title: "Gamma", slug: "gamma", state: "draft" }),
  ];

  it("lists them in the given order, with the first Move up and the last Move down off", () => {
    render(<TutorialList tutorials={three} />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getByRole("link").textContent)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect((screen.getByRole("button", { name: "Move Alpha up" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Move Gamma down" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Video · Advanced")).toBeTruthy();
  });

  it("moves a row at once, sends the whole new order, and announces it", async () => {
    reorderTutorials.mockResolvedValue({ ok: true, data: null });
    render(<TutorialList tutorials={three} />);
    fireEvent.click(screen.getByRole("button", { name: "Move Gamma up" }));
    const titles = () => screen.getAllByRole("row").slice(1).map((r) => within(r).getByRole("link").textContent);
    expect(titles()).toEqual(["Alpha", "Gamma", "Beta"]);
    await waitFor(() => expect(reorderTutorials).toHaveBeenCalledWith(["a", "c", "b"]));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.getByRole("status").textContent).toBe("Gamma moved to position 2 of 3.");
  });

  it("puts the list back and says why when the backend refuses", async () => {
    reorderTutorials.mockResolvedValue({ ok: false, reason: "error", message: "Order not saved." });
    render(<TutorialList tutorials={three} />);
    fireEvent.click(screen.getByRole("button", { name: "Move Alpha down" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Order not saved."));
    const titles = screen.getAllByRole("row").slice(1).map((r) => within(r).getByRole("link").textContent);
    expect(titles).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("says the session ended instead of a generic failure", async () => {
    reorderTutorials.mockResolvedValue({ ok: false, reason: "session_expired" });
    render(<TutorialList tutorials={three} />);
    fireEvent.click(screen.getByRole("button", { name: "Move Alpha down" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/session has expired/)));
  });

  it("shows the empty state", () => {
    render(<TutorialList tutorials={[]} />);
    expect(screen.getByText("No tutorials yet.")).toBeTruthy();
  });
});

describe("the group interest table", () => {
  const entries: GroupInterest[] = [
    { user_id: "u1", email: "ada@example.org", created_at: "2026-10-03T12:00:00Z" },
    { user_id: "u2", email: "grace@example.org", created_at: "2026-10-04T12:00:00Z" },
  ];

  it("lists the addresses and counts them", () => {
    render(<InterestTable entries={entries} />);
    expect(screen.getByText("ada@example.org")).toBeTruthy();
    expect(screen.getByText("grace@example.org")).toBeTruthy();
    expect(screen.getByText("2 people")).toBeTruthy();
  });

  it("copies every address, comma-separated", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<InterestTable entries={entries} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy all email addresses" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("ada@example.org, grace@example.org"));
    expect(emailList(entries)).toBe("ada@example.org, grace@example.org");
  });

  it("says nobody has asked yet", () => {
    render(<InterestTable entries={[]} />);
    expect(screen.getByText("Nobody has asked yet.")).toBeTruthy();
  });
});

describe("the navigation", () => {
  it("shows Community in the admin nav to an admin and not to staff", () => {
    const { unmount } = render(
      <AdminRoleProvider role="admin">
        <AdminNav />
      </AdminRoleProvider>
    );
    expect(screen.getByRole("link", { name: "Community" }).getAttribute("href")).toBe("/admin/community");
    unmount();
    render(
      <AdminRoleProvider role="staff">
        <AdminNav />
      </AdminRoleProvider>
    );
    expect(screen.queryByRole("link", { name: "Community" })).toBeNull();
  });

  it("links the seven sections and marks the one in view", () => {
    render(<CommunitySubNav />);
    const nav = screen.getByRole("navigation", { name: "Community sections" });
    expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual([
      "Overview", "Workshops", "Tutorials", "Publications", "Page settings", "Files", "Group interest",
    ]);
    // The mocked path is a workshop's editor: Workshops is current, Overview is not.
    expect(within(nav).getByRole("link", { name: "Workshops" }).getAttribute("aria-current")).toBe("page");
    expect(within(nav).getByRole("link", { name: "Overview" }).getAttribute("aria-current")).toBeNull();
  });
});

describe("the audit log", () => {
  it("has a Content tab that filters by the content category", () => {
    render(<AuditLogTable entries={[]} activeCategory="content" basePath="/admin/audit" />);
    const tab = screen.getByRole("link", { name: "Content" });
    expect(tab.getAttribute("href")).toBe("/admin/audit?category=content");
    expect(tab.getAttribute("aria-current")).toBe("page");
  });
});
