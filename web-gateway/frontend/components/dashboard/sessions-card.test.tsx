import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const { toast, refresh, signOut, revokeMySession, logoutAllSessions } = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn() },
  refresh: vi.fn(),
  signOut: vi.fn(),
  revokeMySession: vi.fn(),
  logoutAllSessions: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("next-auth/react", () => ({ signOut }));
vi.mock("@/lib/account/actions", () => ({ revokeMySession, logoutAllSessions }));

import { SessionsCard } from "@/components/dashboard/sessions-card";
import type { SessionEntry } from "@/lib/account/types";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const NOW = new Date().toISOString();
const sessions: SessionEntry[] = [
  { id: "s1", created_at: NOW, last_used_at: NOW, user_agent: "Macintosh", current: true },
  { id: "s2", created_at: NOW, last_used_at: NOW, user_agent: "iPhone", current: false },
];

describe("the signed-in devices card", () => {
  it("says it could not load the sessions, instead of claiming there are none, and reloads on request", () => {
    render(<SessionsCard sessions={null} />);
    expect(screen.getByRole("alert").textContent).toBe("Couldn't load your sessions.");
    expect(screen.queryByText("No active sessions.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("still says there are none when the list loaded empty", () => {
    render(<SessionsCard sessions={[]} />);
    expect(screen.getByText("No active sessions.")).toBeTruthy();
  });

  it("asks before signing out a device, and does nothing on Cancel", () => {
    render(<SessionsCard sessions={sessions} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    const dialog = within(screen.getByRole("alertdialog"));
    expect(dialog.getByText("Sign out this device?")).toBeTruthy();
    expect(revokeMySession).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
    expect(revokeMySession).not.toHaveBeenCalled();
    expect(screen.getByText("iPhone")).toBeTruthy();
  });

  it("signs the device out once confirmed, and drops it from the list", async () => {
    revokeMySession.mockResolvedValue({ ok: true });
    render(<SessionsCard sessions={sessions} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Sign out device" }));
    await waitFor(() => expect(screen.queryByText("iPhone")).toBeNull());
    expect(revokeMySession).toHaveBeenCalledWith("s2");
    expect(toast.success).toHaveBeenCalledWith("Device signed out.");
  });

  it("asks before signing out everywhere, then signs out the client", async () => {
    logoutAllSessions.mockResolvedValue({ ok: true });
    render(<SessionsCard sessions={sessions} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out everywhere" }));
    expect(logoutAllSessions).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Sign out everywhere" }));
    await waitFor(() => expect(signOut).toHaveBeenCalledWith({ callbackUrl: "/" }));
    expect(toast.success).toHaveBeenCalledWith("Signed out of every device.");
  });

  it("says so, and does not sign out the client, when signing out everywhere fails", async () => {
    logoutAllSessions.mockResolvedValue({ ok: false });
    render(<SessionsCard sessions={sessions} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out everywhere" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Sign out everywhere" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't sign out of every device. Try again."));
    expect(signOut).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
});
