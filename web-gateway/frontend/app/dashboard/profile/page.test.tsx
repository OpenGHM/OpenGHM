import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const { requireSession, fetchMe } = vi.hoisted(() => ({
  requireSession: vi.fn(),
  fetchMe: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ cilogonConfigured: false }));
vi.mock("@/lib/auth-guard", () => ({ requireSession }));
vi.mock("@/lib/account/actions", () => ({ fetchMe }));
vi.mock("@/components/layout/page-hero", () => ({
  PageHero: () => null,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/landing/footer", () => ({ Footer: () => null }));
vi.mock("@/components/dashboard/account-card", () => ({ AccountCard: () => <div>account</div> }));
vi.mock("@/components/dashboard/email-verification-banner", () => ({ EmailVerificationBanner: () => null }));
vi.mock("@/components/dashboard/sso-result-toast", () => ({ SsoResultToast: () => null }));

import ProfilePage, { metadata } from "@/app/dashboard/profile/page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderPage() {
  render(await ProfilePage({ searchParams: Promise.resolve({}) }));
}

describe("the profile page", () => {
  it("has a document title", () => {
    expect(metadata.title).toBe("My Profile | OpenGHM");
  });

  it("sends a signed-out visitor to sign in with the page as the way back", async () => {
    requireSession.mockImplementation(() => {
      throw new Error("redirect");
    });
    await expect(renderPage()).rejects.toThrow("redirect");
    expect(requireSession).toHaveBeenCalledWith("/dashboard/profile");
  });

  it("shows the account card, or says the profile could not be loaded", async () => {
    requireSession.mockResolvedValue({});
    fetchMe.mockResolvedValue({ email_verified: true });
    await renderPage();
    expect(screen.getByText("account")).toBeTruthy();
    cleanup();
    fetchMe.mockRejectedValue(new Error("boom"));
    await renderPage();
    expect(screen.getByText(/Failed to load your profile/)).toBeTruthy();
  });
});
