import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const { useSession, signOut, revokeSession } = vi.hoisted(() => ({
  useSession: vi.fn(),
  signOut: vi.fn(),
  revokeSession: vi.fn(),
}));
vi.mock("next-auth/react", () => ({ useSession, signOut }));
vi.mock("@/lib/auth-actions", () => ({ revokeSession }));
const { usePathname } = vi.hoisted(() => ({ usePathname: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname }));

import { Header } from "@/components/landing/header";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  usePathname.mockReturnValue("/");
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function openMenu() {
  fireEvent.pointerDown(screen.getByRole("button", { name: "Open menu" }), {
    button: 0,
    ctrlKey: false,
  });
  return within(screen.getByRole("menu"));
}

function signedIn(role: "user" | "admin" | "staff") {
  useSession.mockReturnValue({
    data: { user: { name: "Ada", email: "ada@example.org", role } },
  });
}

describe("the header's phone menu", () => {
  it("is a 40 px button, shown only below lg", () => {
    useSession.mockReturnValue({ data: null });
    render(<Header />);
    const button = screen.getByRole("button", { name: "Open menu" });
    expect(button.className).toContain("size-10");
    expect(button.className).toContain("lg:hidden");
    // The row of links is what it replaces.
    expect(screen.getByRole("navigation", { name: "Main" }).className).toContain("hidden");
  });

  it("lists the links, the Resources items and Sign In for a visitor", () => {
    useSession.mockReturnValue({ data: null });
    render(<Header />);
    const menu = openMenu();
    const labels = menu.getAllByRole("menuitem").map((el) => el.textContent);
    expect(labels).toEqual([
      "Home", "Data Repository", "Workspace", "Models", "Toolkit", "Community", "About", "Sign In",
    ]);
    expect(menu.getByRole("menuitem", { name: "Workspace" }).getAttribute("href")).toBe("/workspace");
    expect(menu.getByRole("menuitem", { name: "Sign In" }).getAttribute("href")).toBe("/auth/signin");
    expect(menu.getByText("Resources")).toBeTruthy();
  });

  it("offers a signed-in user their profile and sign out, as the desktop menu does", () => {
    signedIn("user");
    render(<Header />);
    const menu = openMenu();
    const labels = menu.getAllByRole("menuitem").map((el) => el.textContent);
    expect(labels.slice(-2)).toEqual(["My Profile", "Sign out"]);
    expect(labels).not.toContain("Admin");
    expect(labels).not.toContain("Sign In");
    expect(menu.getByText("ada@example.org")).toBeTruthy();
  });

  it.each(["admin", "staff"] as const)("adds Admin for %s", (role) => {
    signedIn(role);
    render(<Header />);
    const menu = openMenu();
    expect(menu.getByRole("menuitem", { name: "Admin" }).getAttribute("href")).toBe("/admin");
  });

  it("signs out the way the desktop menu does: revoke, then clear the session", async () => {
    signedIn("user");
    revokeSession.mockResolvedValue(undefined);
    render(<Header />);
    const menu = openMenu();
    fireEvent.click(menu.getByRole("menuitem", { name: "Sign out" }));
    await vi.waitFor(() => expect(signOut).toHaveBeenCalledWith({ callbackUrl: "/" }));
    expect(revokeSession).toHaveBeenCalledTimes(1);
  });
});

describe("the header's current-page highlight", () => {
  function current(): string[] {
    const nav = screen.getByRole("navigation", { name: "Main" });
    return within(nav)
      .getAllByRole("link")
      .filter((el) => el.getAttribute("aria-current") === "page")
      .map((el) => el.textContent ?? "");
  }

  it.each([
    ["/repository", "Data Repository"],
    ["/repository/abc", "Data Repository"],
    ["/workspace", "Workspace"],
    ["/workspace/new/pick", "Workspace"],
    ["/", "Home"],
    ["/about", "About"],
  ])("lights only the right tab on %s", (path, label) => {
    usePathname.mockReturnValue(path);
    useSession.mockReturnValue({ data: null });
    render(<Header />);
    expect(current()).toEqual([label]);
  });

  it("lights nothing on a page that is not a tab", () => {
    usePathname.mockReturnValue("/dashboard/profile");
    useSession.mockReturnValue({ data: null });
    render(<Header />);
    expect(current()).toEqual([]);
  });

  it("does not match a path that only shares a prefix", () => {
    usePathname.mockReturnValue("/repositoryx");
    useSession.mockReturnValue({ data: null });
    render(<Header />);
    expect(current()).toEqual([]);
  });

  it("gives the lit tab a block, and every tab the same shape", () => {
    usePathname.mockReturnValue("/repository");
    useSession.mockReturnValue({ data: null });
    render(<Header />);
    const nav = within(screen.getByRole("navigation", { name: "Main" }));
    const lit = nav.getByRole("link", { name: "Data Repository" });
    expect(lit.className).toContain("bg-slate-100");
    expect(lit.className).toContain("text-foreground");
    expect(lit.className).not.toContain("text-primary");
    for (const name of ["Home", "Workspace", "Community", "About"]) {
      const link = nav.getByRole("link", { name });
      expect(link.className).toContain("px-3");
      expect(link.className).not.toContain("bg-slate-100");
    }
  });

  it("marks the current item in the phone menu too, and only that one", () => {
    usePathname.mockReturnValue("/repository/abc");
    useSession.mockReturnValue({ data: null });
    render(<Header />);
    const menu = openMenu();
    const lit = menu.getAllByRole("menuitem").filter((el) => el.getAttribute("aria-current") === "page");
    expect(lit.map((el) => el.textContent)).toEqual(["Data Repository"]);
    expect(lit[0].className).toContain("bg-slate-100");
  });
});
