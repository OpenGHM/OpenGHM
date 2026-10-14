import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const { connectCilogon, disconnectCilogon, signIn, toast, refresh } = vi.hoisted(() => ({
  connectCilogon: vi.fn(),
  disconnectCilogon: vi.fn(),
  signIn: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  refresh: vi.fn(),
}));
vi.mock("@/lib/account/actions", () => ({ connectCilogon, disconnectCilogon }));
vi.mock("next-auth/react", () => ({ signIn }));
vi.mock("sonner", () => ({ toast }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { SignInMethods } from "@/components/dashboard/sign-in-methods";
import type { UserProfile } from "@/lib/account/types";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const profile: UserProfile = {
  id: "u1",
  email: "ada@example.org",
  name: "Ada Lovelace",
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
const connected: Partial<UserProfile> = { sso_provider: "cilogon", sso_email: "ada@purdue.edu" };

function setup(over: Partial<UserProfile> = {}, cilogonEnabled = true) {
  render(<SignInMethods profile={{ ...profile, ...over }} cilogonEnabled={cilogonEnabled} />);
}

describe("the password row", () => {
  it("says it is set", () => {
    setup();
    expect(screen.getByText("Sign-in methods")).toBeTruthy();
    expect(screen.getByText("Set")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Set a password" })).toBeNull();
  });

  it("says it is not set and links to setting one", () => {
    setup({ ...connected, has_password: false });
    expect(screen.getByText("Not set")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Set a password" }).getAttribute("href")).toBe(
      "/auth/forgot-password"
    );
  });
});

describe("the CILogon row", () => {
  it("is not there when CILogon is not configured on this server", () => {
    setup({}, false);
    expect(screen.queryByText("CILogon")).toBeNull();
    expect(screen.queryByRole("button", { name: "Connect CILogon" })).toBeNull();
  });

  it("offers to connect when none is connected", () => {
    setup();
    expect(screen.getByText("CILogon")).toBeTruthy();
    expect(screen.queryByText("Connected")).toBeNull();
    expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();
    expect(screen.getByRole("button", { name: "Connect CILogon" })).toBeTruthy();
  });

  it("says it is connected and as which address", () => {
    setup(connected);
    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.getByText("as ada@purdue.edu")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Connect CILogon" })).toBeNull();
  });

  it("says it is connected without an address when CILogon gave none", () => {
    setup({ sso_provider: "cilogon", sso_email: null });
    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.queryByText(/^as /)).toBeNull();
  });
});

describe("connecting", () => {
  it("records the intent and then goes to CILogon with prompt=login, back to the profile", async () => {
    connectCilogon.mockResolvedValue({ ok: true });
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Connect CILogon" }));
    await waitFor(() =>
      expect(signIn).toHaveBeenCalledWith(
        "cilogon",
        { redirectTo: "/dashboard/profile" },
        { prompt: "login" }
      )
    );
    expect(connectCilogon).toHaveBeenCalledTimes(1);
    expect(connectCilogon.mock.invocationCallOrder[0]).toBeLessThan(signIn.mock.invocationCallOrder[0]);
  });

  it("does not go to CILogon when the intent could not be recorded, and says why", async () => {
    connectCilogon.mockResolvedValue({ ok: false, message: "This account already has a CILogon identity connected." });
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Connect CILogon" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("This account already has a CILogon identity connected.")
    );
    expect(signIn).not.toHaveBeenCalled();
  });
});

describe("disconnecting", () => {
  it("asks first, and disconnects only on confirm, then refreshes", async () => {
    disconnectCilogon.mockResolvedValue({ ok: true });
    setup(connected);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(await screen.findByText("Disconnect CILogon?")).toBeTruthy();
    expect(disconnectCilogon).not.toHaveBeenCalled();

    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(disconnectCilogon).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("CILogon disconnected.");
  });

  it("keeps the dialog open with the backend's reason when it is refused", async () => {
    disconnectCilogon.mockResolvedValue({ ok: false, message: "No CILogon identity is connected to this account." });
    setup(connected);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    await screen.findByRole("alertdialog");
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Disconnect" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "No CILogon identity is connected to this account."
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it("is disabled, with the reason, when the account has no password", () => {
    setup({ ...connected, has_password: false });
    const button = screen.getByRole("button", { name: "Disconnect" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText(/CILogon is its only way to sign in/)).toBeTruthy();
    fireEvent.click(button);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
