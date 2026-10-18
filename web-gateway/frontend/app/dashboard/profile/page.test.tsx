import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const { requireSession, fetchMe, fetchMySessions } = vi.hoisted(() => ({
  requireSession: vi.fn(),
  fetchMe: vi.fn(),
  fetchMySessions: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ cilogonConfigured: false }));
vi.mock("@/lib/auth-guard", () => ({ requireSession }));
vi.mock("@/lib/account/actions", () => ({ fetchMe, fetchMySessions }));
vi.mock("@/components/layout/page-hero", () => ({
  PageHero: () => null,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/landing/footer", () => ({ Footer: () => null }));
vi.mock("@/components/dashboard/account-card", () => ({ AccountCard: () => <div>account</div> }));
vi.mock("@/components/dashboard/email-verification-banner", () => ({ EmailVerificationBanner: () => null }));
vi.mock("@/components/dashboard/sso-result-toast", () => ({ SsoResultToast: () => null }));
vi.mock("@/components/dashboard/sessions-card", () => ({
  SessionsCard: ({ sessions }: { sessions: unknown[] | null }) => (
    <div>{sessions === null ? "sessions failed" : `sessions ${sessions.length}`}</div>
  ),
}));

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

  it("hands the sessions card the list, or null when the list could not be loaded", async () => {
    requireSession.mockResolvedValue({});
    fetchMe.mockResolvedValue({ email_verified: true });
    fetchMySessions.mockResolvedValue({ items: [{ id: "s1" }] });
    await renderPage();
    expect(screen.getByText("sessions 1")).toBeTruthy();
    cleanup();
    fetchMySessions.mockRejectedValue(new Error("boom"));
    await renderPage();
    expect(screen.getByText("sessions failed")).toBeTruthy();
  });
});
