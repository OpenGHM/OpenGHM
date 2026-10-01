import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { revokeUserSession, revokeAllUserSessions, toast } = vi.hoisted(() => ({
  revokeUserSession: vi.fn(),
  revokeAllUserSessions: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/lib/admin/actions", () => ({ revokeUserSession, revokeAllUserSessions }));
vi.mock("sonner", () => ({ toast }));

import { SignOutDialog } from "@/components/admin/sign-out-dialog";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function setup(over: Partial<React.ComponentProps<typeof SignOutDialog>> = {}) {
  const onSignedOut = vi.fn();
  render(
    <SignOutDialog
      scope="device"
      userId="u1"
      sessionId="s1"
      device="Firefox on Linux"
      onSignedOut={onSignedOut}
      {...over}
    >
      <button>Open</button>
    </SignOutDialog>
  );
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  return { onSignedOut };
}

describe("the sign-out-device dialog", () => {
  it("says what will happen and names the device", async () => {
    setup();
    expect(await screen.findByText("Sign this device out?")).toBeTruthy();
    expect(screen.getByText(/signed out immediately/)).toBeTruthy();
    expect(screen.getByText(/Their other devices stay signed in/)).toBeTruthy();
    expect(screen.getByText("Firefox on Linux")).toBeTruthy();
  });

  it("does nothing until it is confirmed", async () => {
    setup();
    await screen.findByRole("alertdialog");
    expect(revokeUserSession).not.toHaveBeenCalled();
  });

  it("signs the device out on confirm, closes and tells the caller", async () => {
    revokeUserSession.mockResolvedValue({ ok: true });
    const { onSignedOut } = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Sign out device" }));
    await waitFor(() => expect(onSignedOut).toHaveBeenCalled());
    expect(revokeUserSession).toHaveBeenCalledWith("u1", "s1");
    expect(toast.success).toHaveBeenCalledWith("Device signed out.");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("stays open while the request is in flight", async () => {
    let answer: (value: unknown) => void = () => {};
    revokeUserSession.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const { onSignedOut } = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Sign out device" }));

    await screen.findByRole("button", { name: "Signing out…" });
    expect((screen.getByRole("button", { name: "Keep signed in" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(onSignedOut).not.toHaveBeenCalled();

    answer({ ok: true });
    await waitFor(() => expect(onSignedOut).toHaveBeenCalled());
  });

  it("stays open on failure with the reason in the dialog and in a toast", async () => {
    revokeUserSession.mockResolvedValue({ ok: false });
    const { onSignedOut } = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Sign out device" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Couldn't sign this device out/);
    expect(toast.error).toHaveBeenCalled();
    expect(onSignedOut).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    // And it can be tried again.
    expect((screen.getByRole("button", { name: "Sign out device" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("reports a thrown request the same way", async () => {
    revokeUserSession.mockRejectedValue(new Error("network"));
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Sign out device" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Couldn't sign this device out/);
  });
});

describe("the sign-out-everywhere dialog", () => {
  it("says every device goes, and signs them all out on confirm", async () => {
    revokeAllUserSessions.mockResolvedValue({ ok: true, revoked: 3 });
    const { onSignedOut } = setup({ scope: "all", sessionId: undefined, device: undefined });
    expect(await screen.findByText("Sign out every device?")).toBeTruthy();
    expect(screen.getByText(/Every device signed in as this user/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign out all devices" }));
    await waitFor(() => expect(onSignedOut).toHaveBeenCalled());
    expect(revokeAllUserSessions).toHaveBeenCalledWith("u1");
    expect(revokeUserSession).not.toHaveBeenCalled();
  });
});
