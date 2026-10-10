import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const { usePathname, signOut, revokeSession } = vi.hoisted(() => ({
  usePathname: vi.fn(),
  signOut: vi.fn(),
  revokeSession: vi.fn(),
}));
vi.mock("next/navigation", () => ({ usePathname }));
vi.mock("next-auth/react", () => ({ signOut }));
vi.mock("@/lib/auth-actions", () => ({ revokeSession }));

import { AdminNav, AdminRoleProvider, currentSectionLabel } from "@/components/admin/admin-nav";
import { AdminShell } from "@/components/admin/admin-shell";
import type { UserRole } from "@/lib/auth.types";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

beforeEach(() => {
  usePathname.mockReturnValue("/admin");
  revokeSession.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderNav(role: UserRole) {
  return render(
    <AdminRoleProvider role={role}>
      <AdminNav />
    </AdminRoleProvider>
  );
}

function renderShell(role: UserRole = "admin") {
  return render(
    <AdminRoleProvider role={role} name="Ada Lovelace" email="ada@example.org">
      <AdminShell>
        <p>Page content</p>
      </AdminShell>
    </AdminRoleProvider>
  );
}

describe("the sidebar nav", () => {
  it("groups the sections for an admin, Community included", () => {
    renderNav("admin");
    const console = screen.getByRole("group", { name: "Console" });
    expect(within(console).getAllByRole("link").map((a) => a.textContent)).toEqual([
      "Overview", "Users", "Jobs", "Audit log", "System",
    ]);
    const community = screen.getByRole("group", { name: "Community" });
    expect(within(community).getAllByRole("link").map((a) => a.textContent)).toEqual([
      "Overview", "Workshops", "Tutorials", "Publications", "Page settings", "Files",
    ]);
    expect(within(community).getByRole("link", { name: "Workshops" }).getAttribute("href")).toBe(
      "/admin/community/workshops"
    );
  });

  it("hides the admin-only items and the whole Community group from staff", () => {
    renderNav("staff");
    expect(screen.getByRole("group", { name: "Console" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Community" })).toBeNull();
    expect(screen.queryByRole("link", { name: "System" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Workshops" })).toBeNull();
    expect(screen.getByRole("link", { name: "Audit log" })).toBeTruthy();
  });

  it("marks the overview current only on its exact path", () => {
    usePathname.mockReturnValue("/admin");
    const { unmount } = renderNav("admin");
    const consoleGroup = () => within(screen.getByRole("group", { name: "Console" }));
    expect(consoleGroup().getByRole("link", { name: "Overview" }).getAttribute("aria-current")).toBe("page");
    unmount();

    usePathname.mockReturnValue("/admin/users");
    renderNav("admin");
    expect(consoleGroup().getByRole("link", { name: "Overview" }).getAttribute("aria-current")).toBeNull();
    expect(consoleGroup().getByRole("link", { name: "Users" }).getAttribute("aria-current")).toBe("page");
  });

  it("keeps a section current on the pages below it", () => {
    usePathname.mockReturnValue("/admin/users/u-1");
    renderNav("admin");
    expect(screen.getByRole("link", { name: "Users" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page")).toHaveLength(1);
  });

  it("tells the Community overview from the sections below it", () => {
    usePathname.mockReturnValue("/admin/community/workshops/w1");
    renderNav("admin");
    const community = within(screen.getByRole("group", { name: "Community" }));
    expect(community.getByRole("link", { name: "Workshops" }).getAttribute("aria-current")).toBe("page");
    expect(community.getByRole("link", { name: "Overview" }).getAttribute("aria-current")).toBeNull();
  });

  it("names the section for the phone top bar", () => {
    expect(currentSectionLabel("/admin")).toBe("Overview");
    expect(currentSectionLabel("/admin/users/u-1")).toBe("Users");
    expect(currentSectionLabel("/admin/community")).toBe("Community · Overview");
    expect(currentSectionLabel("/admin/community/tutorials/new")).toBe("Community · Tutorials");
    expect(currentSectionLabel("/admin/nowhere")).toBe("Admin console");
  });
});

describe("the admin shell", () => {
  it("renders the page in <main>, with a skip link to it", () => {
    renderShell();
    const main = screen.getByRole("main");
    expect(main.id).toBe("admin-main");
    expect(within(main).getByText("Page content")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Skip to content" }).getAttribute("href")).toBe("#admin-main");
  });

  it("carries the logo, the way back to the site and the signed-in user in the sidebar", () => {
    renderShell();
    const sidebar = within(screen.getByRole("complementary", { name: "Admin sidebar" }));
    expect(sidebar.getByText("Admin console")).toBeTruthy();
    expect(sidebar.getByRole("link", { name: "Back to site" }).getAttribute("href")).toBe("/");
    expect(sidebar.getByAltText("OpenGHM Logo").closest("a")?.getAttribute("href")).toBe("/");
    expect(sidebar.getByText("Ada Lovelace")).toBeTruthy();
    expect(sidebar.getByText("Admin")).toBeTruthy();
    expect(sidebar.queryByText("Staff · read-only")).toBeNull();
  });

  it("shows staff the read-only badge and no Community group", () => {
    renderShell("staff");
    const sidebar = within(screen.getByRole("complementary", { name: "Admin sidebar" }));
    expect(sidebar.getByText("Staff · read-only")).toBeTruthy();
    expect(sidebar.queryByRole("group", { name: "Community" })).toBeNull();
  });

  it("signs out through the site's flow: the backend revoke, then the client session", async () => {
    renderShell();
    const sidebar = within(screen.getByRole("complementary", { name: "Admin sidebar" }));
    fireEvent.click(sidebar.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(signOut).toHaveBeenCalledWith({ callbackUrl: "/" }));
    expect(revokeSession).toHaveBeenCalledTimes(1);
  });

  it("opens the same nav in a sheet from the phone menu button, and closes it on navigation", async () => {
    renderShell();
    expect(screen.getAllByRole("navigation", { name: "Admin" })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Open admin menu" }));
    const dialog = await screen.findByRole("dialog", { name: "Admin menu" });
    // The dialog hides the page behind it, so the sheet's nav is the one in the tree.
    expect(within(dialog).getByRole("navigation", { name: "Admin" })).toBeTruthy();
    const users = within(dialog).getByRole("link", { name: "Users" });
    expect(within(dialog).getByRole("group", { name: "Community" })).toBeTruthy();

    fireEvent.click(users);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("closes the sheet when the path changes under it", async () => {
    const { rerender } = renderShell();
    fireEvent.click(screen.getByRole("button", { name: "Open admin menu" }));
    await screen.findByRole("dialog", { name: "Admin menu" });

    usePathname.mockReturnValue("/admin/jobs");
    rerender(
      <AdminRoleProvider role="admin" name="Ada Lovelace" email="ada@example.org">
        <AdminShell>
          <p>Page content</p>
        </AdminShell>
      </AdminRoleProvider>
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
