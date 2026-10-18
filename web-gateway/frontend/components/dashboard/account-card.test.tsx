import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { toast, signOut, changePassword } = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn() },
  signOut: vi.fn(),
  changePassword: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next-auth/react", () => ({ signOut }));
vi.mock("@/lib/account/actions", () => ({ updateMe: vi.fn(), changePassword }));
vi.mock("@/components/dashboard/sign-in-methods", () => ({ SignInMethods: () => null }));

import { AccountCard } from "@/components/dashboard/account-card";
import type { UserProfile } from "@/lib/account/types";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const profile: UserProfile = {
  id: "u1",
  email: "ada@purdue.edu",
  name: "Ada",
  role: "user",
  organization: null,
  email_verified: true,
  is_active: true,
  can_run_simulations: false,
  created_at: null,
  sso_provider: null,
  sso_email: null,
  has_password: true,
};

function openForm() {
  render(<AccountCard profile={profile} />);
  fireEvent.click(screen.getByRole("button", { name: "Change password" }));
}

describe("the change-password fields", () => {
  it("are one form, so Enter submits and a password manager sees the account", async () => {
    changePassword.mockResolvedValue({ ok: true });
    openForm();
    const form = screen.getByLabelText("Current password").closest("form");
    expect(form).not.toBeNull();
    expect(form!.querySelector('input[autocomplete="username"]')).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "old-password" } });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "new-password-1" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "new-password-1" } });
    fireEvent.submit(form!);
    await waitFor(() => expect(changePassword).toHaveBeenCalledWith("old-password", "new-password-1"));
  });

  it("refuse a mismatch without calling the backend", () => {
    openForm();
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "old-password" } });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "new-password-1" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "other-password" } });
    fireEvent.submit(screen.getByLabelText("Current password").closest("form")!);
    expect(screen.getByText("Passwords do not match.")).toBeTruthy();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("sign the user out to the sign-in page with the changed-password notice", async () => {
    changePassword.mockResolvedValue({ ok: true });
    openForm();
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "old-password" } });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "new-password-1" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "new-password-1" } });
    fireEvent.submit(screen.getByLabelText("Current password").closest("form")!);
    await waitFor(() => expect(signOut).toHaveBeenCalledWith({ callbackUrl: "/auth/signin?passwordChanged=1" }));
  });
});
