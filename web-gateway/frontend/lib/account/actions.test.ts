import { afterEach, describe, expect, it, vi } from "vitest";

const { cookieStore, currentSession, client } = vi.hoisted(() => ({
  cookieStore: { set: vi.fn() },
  currentSession: vi.fn(),
  client: { post: vi.fn(), delete: vi.fn() },
}));
vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));
vi.mock("@/lib/auth", () => ({ auth: currentSession }));
vi.mock("@/lib/api-client", () => ({ getApiClient: async () => client }));

import { changePassword, connectCilogon, disconnectCilogon } from "@/lib/account/actions";
import { SSO_CONNECT_COOKIE } from "@/lib/sso-connect";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

const refused = (detail: string) => ({ response: { data: { detail } } });

describe("connectCilogon", () => {
  it("leaves the intent's token in an httpOnly cookie that names the signed-in user", async () => {
    currentSession.mockResolvedValue({ user: { id: "user-1" } });
    client.post.mockResolvedValue({ data: { connect_token: "intent" } });
    vi.stubEnv("AUTH_URL", "https://gateway.example.org");

    expect(await connectCilogon()).toEqual({ ok: true });
    expect(client.post).toHaveBeenCalledWith("/api/v1/auth/sso-connect-intent");
    expect(cookieStore.set).toHaveBeenCalledWith(SSO_CONNECT_COOKIE, "user-1:intent", {
      httpOnly: true,
      // The callback is a cross-site navigation from CILogon; strict would not send it.
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 600,
    });
  });

  it("is not a secure cookie on plain http, as on a local stack", async () => {
    currentSession.mockResolvedValue({ user: { id: "user-1" } });
    client.post.mockResolvedValue({ data: { connect_token: "intent" } });
    vi.stubEnv("AUTH_URL", "http://localhost:3100");
    await connectCilogon();
    expect(cookieStore.set.mock.calls[0][2]).toMatchObject({ secure: false });
  });

  it("asks nothing of the backend and sets nothing without a signed-in user", async () => {
    currentSession.mockResolvedValue(null);
    expect(await connectCilogon()).toEqual({
      ok: false,
      message: "Sign in again, then connect CILogon.",
    });
    expect(client.post).not.toHaveBeenCalled();
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("gives the backend's reason when it refuses, and sets no cookie", async () => {
    currentSession.mockResolvedValue({ user: { id: "user-1" } });
    client.post.mockRejectedValue(refused("This account already has a CILogon identity connected."));
    expect(await connectCilogon()).toEqual({
      ok: false,
      message: "This account already has a CILogon identity connected.",
    });
    expect(cookieStore.set).not.toHaveBeenCalled();
  });
});

describe("disconnectCilogon", () => {
  it("deletes the connection", async () => {
    client.delete.mockResolvedValue({});
    expect(await disconnectCilogon()).toEqual({ ok: true });
    expect(client.delete).toHaveBeenCalledWith("/api/v1/users/me/sso");
  });

  it("gives the backend's reason when it refuses", async () => {
    client.delete.mockRejectedValue(
      refused("This account has no password, so CILogon is its only way to sign in.")
    );
    expect(await disconnectCilogon()).toEqual({
      ok: false,
      message: "This account has no password, so CILogon is its only way to sign in.",
    });
  });

  it("falls back to a message of its own when the backend gave none", async () => {
    client.delete.mockRejectedValue(new Error("network"));
    expect(await disconnectCilogon()).toEqual({ ok: false, message: "Could not disconnect CILogon." });
  });
});

describe("changePassword", () => {
  it("says what the backend refused with, when it is a sentence", async () => {
    client.post.mockRejectedValue(refused("Current password is incorrect"));
    expect(await changePassword("old", "new-password-1")).toEqual({
      ok: false,
      message: "Current password is incorrect",
    });
  });

  it("reads the rule out of the field errors of a rejected new password", async () => {
    client.post.mockRejectedValue({
      response: {
        data: { detail: [{ loc: ["body", "new_password"], msg: "must be at least 8 characters" }] },
      },
    });
    expect(await changePassword("old", "short")).toEqual({
      ok: false,
      message: "Password: must be at least 8 characters.",
    });
  });

  it("falls back to a generic line when there is nothing to read", async () => {
    client.post.mockRejectedValue(new Error("down"));
    expect(await changePassword("old", "new-password-1")).toEqual({
      ok: false,
      message: "Failed to change password.",
    });
  });
});
