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
import { SiteFeaturesProvider } from "@/components/site-features";

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

  it("lists the links, Resources marked Coming soon, and Sign In for a visitor", () => {
    useSession.mockReturnValue({ data: null });
    render(<Header />);
    const menu = openMenu();
    const labels = menu.getAllByRole("menuitem").map((el) => el.textContent);
    expect(labels).toEqual([
      "Home", "Data Repository", "Workspace", "ResourcesComing soon", "Community", "About", "Sign In",
    ]);
    expect(menu.getByRole("menuitem", { name: /Resources/ }).getAttribute("aria-disabled")).toBe("true");
    expect(menu.getByRole("menuitem", { name: "Workspace" }).getAttribute("href")).toBe("/workspace");
    expect(menu.getByRole("menuitem", { name: "Community" }).getAttribute("href")).toBe("/community");
    expect(menu.getByRole("menuitem", { name: "Sign In" }).getAttribute("href")).toBe("/auth/signin");
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

describe("the header's account menu", () => {
  const trigger = () => screen.getByRole("button", { name: /Ada/ });

  it("is a menu button that is closed until it is used", () => {
    signedIn("user");
    render(<Header />);
    expect(trigger().getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens on a click, with My Profile and Sign out in it", () => {
    signedIn("user");
    render(<Header />);
    fireEvent.pointerDown(trigger(), { button: 0, ctrlKey: false });
    const menu = within(screen.getByRole("menu"));
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(menu.getByRole("menuitem", { name: "My Profile" }).getAttribute("href")).toBe("/dashboard/profile");
    expect(menu.getByRole("menuitem", { name: "Sign out" })).toBeTruthy();
    expect(menu.queryByRole("menuitem", { name: "Admin" })).toBeNull();
  });

  it.each(["Enter", " ", "ArrowDown"])("opens from the keyboard with %j", (key) => {
    signedIn("user");
    render(<Header />);
    trigger().focus();
    fireEvent.keyDown(trigger(), { key });
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("closes on Escape", () => {
    signedIn("user");
    render(<Header />);
    fireEvent.pointerDown(trigger(), { button: 0, ctrlKey: false });
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("adds Admin for an admin, and signs out as the phone menu does", async () => {
    signedIn("admin");
    revokeSession.mockResolvedValue(undefined);
    render(<Header />);
    fireEvent.pointerDown(trigger(), { button: 0, ctrlKey: false });
    const menu = within(screen.getByRole("menu"));
    expect(menu.getByRole("menuitem", { name: "Admin" }).getAttribute("href")).toBe("/admin");
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
    ["/workspace/new", "Workspace"],
    ["/workspace/data", "Workspace"],
    ["/", "Home"],
    ["/about", "About"],
    ["/community", "Community"],
    ["/community/workshops/first-workshop", "Community"],
    ["/community/tutorials/run-your-first-snapshot", "Community"],
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

  it("points Community at /community, and does not light it for /communityx", () => {
    usePathname.mockReturnValue("/communityx");
    useSession.mockReturnValue({ data: null });
    render(<Header />);
    const nav = within(screen.getByRole("navigation", { name: "Main" }));
    expect(nav.getByRole("link", { name: "Community" }).getAttribute("href")).toBe("/community");
    expect(current()).toEqual([]);
  });

  it("does not match a path that only shares a prefix", () => {
    usePathname.mockReturnValue("/repositoryx");
    useSession.mockReturnValue({ data: null });
    render(<Header />);
    expect(current()).toEqual([]);
  });

  it("gives the lit tab a white pill, and every tab the same shape", () => {
    usePathname.mockReturnValue("/repository");
    useSession.mockReturnValue({ data: null });
    render(<Header />);
    const nav = within(screen.getByRole("navigation", { name: "Main" }));
    const classes = (el: HTMLElement) => el.className.split(" ");
    const lit = nav.getByRole("link", { name: "Data Repository" });
    expect(classes(lit)).toContain("bg-white");
    expect(classes(lit)).toContain("text-foreground");
    expect(classes(lit)).not.toContain("text-hero-foreground-muted");
    for (const name of ["Home", "Workspace", "Community", "About"]) {
      const link = nav.getByRole("link", { name });
      expect(classes(link)).toContain("rounded-full");
      expect(classes(link)).toContain("px-[clamp(9px,1.1vw,16px)]");
      expect(classes(link)).not.toContain("bg-white");
      expect(classes(link)).toContain("text-hero-foreground-muted");
    }
  });

  it("keeps every link on one line, so the row never breaks Data Repository in two", () => {
    useSession.mockReturnValue({ data: null });
    render(<Header />);
    const nav = within(screen.getByRole("navigation", { name: "Main" }));
    for (const name of ["Home", "Data Repository", "Workspace", "Community", "About"]) {
      expect(nav.getByRole("link", { name }).className).toContain("whitespace-nowrap");
    }
    const resources = nav.getByText("Resources");
    expect(resources.className).toContain("whitespace-nowrap");
    // No pages yet: marked, and neither a link nor a menu.
    expect(resources.getAttribute("aria-disabled")).toBe("true");
    expect(resources.textContent).toContain("Coming soon");
  });

  it("marks the current item in the phone menu too, and only that one", () => {
    usePathname.mockReturnValue("/repository/abc");
    useSession.mockReturnValue({ data: null });
    render(<Header />);
    const menu = openMenu();
    const lit = menu.getAllByRole("menuitem").filter((el) => el.getAttribute("aria-current") === "page");
    expect(lit.map((el) => el.textContent)).toEqual(["Data Repository"]);
    expect(lit[0].className).toContain("bg-secondary");
  });
});

describe("the header on the navy band", () => {
  it("is transparent inside a hero and a navy sticky bar on its own", () => {
    useSession.mockReturnValue({ data: null });
    const { container, rerender } = render(<Header variant="overlay" />);
    const overlay = container.querySelector("header");
    expect(overlay?.className).not.toContain("bg-hero");
    expect(overlay?.className).not.toContain("sticky");
    rerender(<Header />);
    const standalone = container.querySelector("header");
    expect(standalone?.className).toContain("bg-hero");
    expect(standalone?.className).toContain("sticky");
  });

  it("shows a visitor a white Sign In pill and a signed-in user a name pill", () => {
    useSession.mockReturnValue({ data: null });
    const { unmount } = render(<Header />);
    const signIn = screen.getAllByRole("link", { name: "Sign In" })[0];
    expect(signIn.getAttribute("href")).toBe("/auth/signin");
    expect(signIn.className).toContain("rounded-full");
    expect(signIn.className.split(" ")).toContain("bg-white");
    unmount();

    signedIn("user");
    render(<Header />);
    expect(screen.queryByRole("link", { name: "Sign In" })).toBeNull();
    expect(screen.getByRole("button", { name: /Ada/ }).className).toContain("rounded-full");
  });
});

describe("the header with the Workspace off", () => {
  const renderOff = () =>
    render(
      <SiteFeaturesProvider features={{ workspace: false }}>
        <Header />
      </SiteFeaturesProvider>
    );

  it("keeps the item, marked Coming soon and not a link", () => {
    useSession.mockReturnValue({ data: null });
    renderOff();
    const nav = within(screen.getByRole("navigation", { name: "Main" }));
    expect(nav.queryByRole("link", { name: /Workspace/ })).toBeNull();
    expect(nav.getByText("Workspace").closest("[aria-disabled]")?.textContent).toContain("Coming soon");
  });

  it("disables it in the phone menu", () => {
    useSession.mockReturnValue({ data: null });
    renderOff();
    const item = openMenu().getByRole("menuitem", { name: /Workspace/ });
    expect(item.getAttribute("aria-disabled")).toBe("true");
    expect(item.textContent).toContain("Coming soon");
  });
});
