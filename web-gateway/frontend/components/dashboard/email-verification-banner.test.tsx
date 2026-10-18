import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { toast, resendVerificationEmail } = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn() },
  resendVerificationEmail: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/lib/auth-actions", () => ({ resendVerificationEmail }));

import { EmailVerificationBanner } from "@/components/dashboard/email-verification-banner";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the email verification banner", () => {
  it("replaces the button with the answer once a resend worked", async () => {
    resendVerificationEmail.mockResolvedValue({ ok: true, message: "Verification email sent." });
    render(<EmailVerificationBanner />);
    fireEvent.click(screen.getByRole("button", { name: "Resend verification email" }));
    await waitFor(() => expect(screen.getByText("Verification email sent.")).toBeTruthy());
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("keeps a button, with the reason, when a resend failed", async () => {
    resendVerificationEmail.mockResolvedValue({ ok: false, message: "Please wait 30s before requesting another verification email" });
    render(<EmailVerificationBanner />);
    fireEvent.click(screen.getByRole("button", { name: "Resend verification email" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Please wait 30s"));
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(toast.error).toHaveBeenCalled();
  });
});
