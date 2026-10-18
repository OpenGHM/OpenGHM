import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const { auth, redirect } = vi.hoisted(() => ({
  auth: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
}));
vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/components/landing/header", () => ({ Header: () => null }));
vi.mock("@/components/landing/footer", () => ({ Footer: () => null }));
vi.mock("@/components/admin/admin-nav", () => ({
  AdminRoleProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/admin/admin-shell", () => ({
  AdminShell: ({ children }: { children: React.ReactNode }) => <div data-testid="shell">{children}</div>,
}));

import AdminLayout from "@/app/admin/layout";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderLayout() {
  render(await AdminLayout({ children: <p>inside</p> }));
}

describe("the admin layout", () => {
  it("sends a signed-out visitor to sign in, and back to the console", async () => {
    auth.mockResolvedValue(null);
    await expect(renderLayout()).rejects.toThrow("redirect:/auth/signin?callbackUrl=%2Fadmin");
  });

  it("tells a signed-in user without the role that they have no access, and links home", async () => {
    auth.mockResolvedValue({ user: { role: "user", name: "Ada", email: "ada@example.org" } });
    await renderLayout();
    expect(screen.getByText("You do not have access to the admin console")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to home" }).getAttribute("href")).toBe("/");
    expect(screen.queryByText("inside")).toBeNull();
    expect(redirect).not.toHaveBeenCalled();
  });

  it.each(["admin", "staff"])("shows the console to %s", async (role) => {
    auth.mockResolvedValue({ user: { role, name: "Ada", email: "ada@example.org" } });
    await renderLayout();
    expect(screen.getByText("inside")).toBeTruthy();
  });
});
