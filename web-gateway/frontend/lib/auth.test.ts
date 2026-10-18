import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cookieStore, requestHeaders, currentSession } = vi.hoisted(() => ({
  cookieStore: { get: vi.fn(), delete: vi.fn() },
  requestHeaders: { get: vi.fn() },
  currentSession: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => cookieStore,
  headers: async () => requestHeaders,
}));
// What matters here is the config handed to NextAuth, not NextAuth.
vi.mock("next-auth", () => ({
  default: () => ({ handlers: {}, signIn: vi.fn(), signOut: vi.fn(), auth: currentSession }),
  CredentialsSignin: class extends Error {
    code = "credentials";
  },
}));
vi.mock("next-auth/providers/credentials", () => ({ default: (config: unknown) => config }));

import { authConfig } from "@/lib/auth";
import { SSO_CONNECT_COOKIE } from "@/lib/sso-connect";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  requestHeaders.get.mockReturnValue("Firefox on Linux");
  cookieStore.get.mockReturnValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const profile = { sub: "cilogon-sub-1", email: "ada@purdue.edu", name: "Ada", idp_name: "Purdue" };

function answer(status: number, body: unknown) {
  fetchMock.mockResolvedValue({ ok: status < 300, status, json: async () => body });
}

function signIn() {
  const user = { id: "x" } as Record<string, unknown>;
  const result = authConfig.callbacks!.signIn!({
    user,
    account: { provider: "cilogon", providerAccountId: "cilogon-sub-1" },
    profile,
  } as never);
  return { user, result: result as Promise<unknown> };
}

function sentBody() {
  return JSON.parse(fetchMock.mock.calls[0][1].body);
}

describe("the CILogon sign-in callback", () => {
  it("signs in as the OpenGHM account, not as the CILogon profile, with no connect token", async () => {
    answer(200, {
      status: "ok",
      auth: {
        access_token: "a",
        refresh_token: "r",
        expires_in: 3600,
        // The account CILogon is connected to: another name and address.
        user: { id: "u1", email: "ada@example.org", name: "Ada Lovelace", role: "user" },
      },
    });
    const { user, result } = signIn();
    expect(await result).toBe(true);
    expect(sentBody().connect_token).toBeNull();
    expect(user).toMatchObject({
      id: "u1",
      name: "Ada Lovelace",
      email: "ada@example.org",
      accessToken: "a",
      refreshToken: "r",
      role: "user",
    });
    expect(cookieStore.delete).not.toHaveBeenCalled();
  });

  it("sends a provider that gave no email to the page that asks for it, with no session", async () => {
    answer(200, { status: "needs_completion", completion_token: "t o/k" });
    const { user, result } = signIn();
    expect(await result).toBe("/auth/complete-profile?token=t%20o%2Fk");
    expect(user).toEqual({ id: "x" });
  });

  it("sends a refused plain sign-in back to the sign-in page with the reason", async () => {
    answer(409, { detail: "taken meanwhile" });
    expect(await signIn().result).toBe("/auth/signin?sso=conflict");
    answer(401, { detail: "This account has been deactivated. Contact an administrator." });
    expect(await signIn().result).toBe("/auth/signin?sso=deactivated");
    answer(401, { detail: "Invalid or missing internal service credentials" });
    expect(await signIn().result).toBe("/auth/signin?sso=failed");
    answer(500, {});
    expect(await signIn().result).toBe("/auth/signin?sso=failed");
  });

  it("sends a sign-in the backend could not be reached for back to the sign-in page", async () => {
    fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED"));
    expect(await signIn().result).toBe("/auth/signin?sso=failed");
  });

  it("sends CILogon's own id, address, name and organization to the backend", async () => {
    answer(200, {
      status: "ok",
      auth: { access_token: "a", refresh_token: "r", expires_in: 60, user: { id: "u", email: "e", name: "n", role: "user" } },
    });
    await signIn().result;
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/auth\/sso-login$/);
    expect(init.headers["User-Agent"]).toBe("Firefox on Linux");
    expect(sentBody()).toEqual({
      email: "ada@purdue.edu",
      name: "Ada",
      external_id: "cilogon-sub-1",
      provider: "cilogon",
      organization: "Purdue",
      connect_token: null,
    });
  });

  describe("after Connect CILogon on the profile", () => {
    beforeEach(() => {
      cookieStore.get.mockImplementation((name: string) =>
        name === SSO_CONNECT_COOKIE ? { value: "user-1:intent-token" } : undefined
      );
      currentSession.mockResolvedValue({ user: { id: "user-1" } });
    });

    it("sends the cookie's token, deletes the cookie, and returns to the profile when connected", async () => {
      answer(200, { status: "connected" });
      const { user, result } = signIn();
      expect(await result).toBe("/dashboard/profile?sso=connected");
      expect(sentBody().connect_token).toBe("intent-token");
      expect(cookieStore.delete).toHaveBeenCalledWith(SSO_CONNECT_COOKIE);
      // No backend session is handed to NextAuth: the user stays as they were.
      expect(user).toEqual({ id: "x" });
    });

    it("sends the identity's own address along, which may differ from the account's", async () => {
      answer(200, { status: "connected" });
      await signIn().result;
      expect(sentBody()).toMatchObject({ email: "ada@purdue.edu", external_id: "cilogon-sub-1" });
    });

    it("says conflict on a 409", async () => {
      answer(409, { detail: "already connected to another" });
      expect(await signIn().result).toBe("/dashboard/profile?sso=conflict");
    });

    it("says failed on any other refusal rather than showing the error page", async () => {
      answer(400, { detail: "expired" });
      expect(await signIn().result).toBe("/dashboard/profile?sso=failed");
      answer(401, { detail: "This account has been deactivated. Contact an administrator." });
      expect(await signIn().result).toBe("/dashboard/profile?sso=failed");
    });

    it("says failed when the backend cannot be reached", async () => {
      fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED"));
      expect(await signIn().result).toBe("/dashboard/profile?sso=failed");
    });

    it("is an ordinary sign-in when the cookie names an account that is no longer signed in", async () => {
      for (const session of [null, { user: { id: "someone-else" } }]) {
        fetchMock.mockClear();
        cookieStore.delete.mockClear();
        currentSession.mockResolvedValue(session);
        answer(200, { status: "ok", auth: { access_token: "a", refresh_token: "r", expires_in: 60, user: { id: "u", email: "e", name: "n", role: "user" } } });
        expect(await signIn().result).toBe(true);
        expect(sentBody().connect_token).toBeNull();
        expect(cookieStore.delete).toHaveBeenCalledWith(SSO_CONNECT_COOKIE);
      }
    });

    it("still connects when the cookie cannot be deleted", async () => {
      cookieStore.delete.mockImplementation(() => {
        throw new Error("read-only");
      });
      answer(200, { status: "connected" });
      expect(await signIn().result).toBe("/dashboard/profile?sso=connected");
    });
  });
});

describe("whether CILogon is configured", () => {
  // Decided from the environment when the module loads, so each case loads it afresh.
  async function load(env: Record<string, string>) {
    vi.resetModules();
    vi.stubEnv("CILOGON_CLIENT_ID", env.id ?? "");
    vi.stubEnv("CILOGON_CLIENT_SECRET", env.secret ?? "");
    return import("@/lib/auth");
  }

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is on with a client id and secret, and lists the provider", async () => {
    const mod = await load({ id: "client", secret: "shh" });
    expect(mod.cilogonConfigured).toBe(true);
    expect((mod.authConfig.providers as { id?: string }[]).some((p) => p.id === "cilogon")).toBe(true);
  });

  it.each([
    { id: "", secret: "" },
    { id: "client", secret: "" },
    { id: "", secret: "shh" },
  ])("is off without both: %j", async (env) => {
    const mod = await load(env);
    expect(mod.cilogonConfigured).toBe(false);
    expect((mod.authConfig.providers as { id?: string }[]).some((p) => p.id === "cilogon")).toBe(false);
  });
});

describe("the email-and-password sign-in", () => {
  type Authorize = (c: Record<string, string>, r?: unknown) => Promise<unknown>;
  const authorize = (authConfig.providers[0] as unknown as { authorize: Authorize }).authorize;
  const creds = { email: "ada@purdue.edu", password: "pw-123456" };

  it("signs in with the backend's tokens", async () => {
    answer(200, {
      access_token: "a",
      refresh_token: "r",
      expires_in: 60,
      user: { id: "u1", email: "ada@purdue.edu", name: "Ada", role: "user" },
    });
    expect(await authorize(creds)).toMatchObject({ id: "u1", accessToken: "a", refreshToken: "r" });
  });

  it("answers a wrong email or password with null, which the form words generically", async () => {
    answer(401, { detail: "Invalid email or password" });
    expect(await authorize(creds)).toBeNull();
    answer(500, {});
    expect(await authorize(creds)).toBeNull();
    fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED"));
    expect(await authorize(creds)).toBeNull();
  });

  it("names a deactivated account, which the backend only does after a correct password", async () => {
    answer(401, { detail: "This account has been deactivated. Contact an administrator." });
    await expect(authorize(creds)).rejects.toMatchObject({ code: "deactivated" });
  });

  it("tells the backend which address it came from, proving the claim with the internal secret", async () => {
    vi.stubEnv("INTERNAL_SERVICE_SECRET", "shh");
    answer(401, {});
    const request = { headers: new Headers({ "x-forwarded-for": "1.2.3.4, 203.0.113.7" }) };
    await authorize(creds, request);
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      "X-Internal-Auth": "shh",
      "X-Client-IP": "203.0.113.7",
    });
    vi.unstubAllEnvs();
  });

  it("sends no address when it has no proof to give with it, or none to give", async () => {
    answer(401, {});
    vi.stubEnv("INTERNAL_SERVICE_SECRET", "");
    await authorize(creds, { headers: new Headers({ "x-forwarded-for": "203.0.113.7" }) });
    vi.stubEnv("INTERNAL_SERVICE_SECRET", "shh");
    await authorize(creds, { headers: new Headers() });
    for (const [, init] of fetchMock.mock.calls) {
      expect(init.headers).not.toHaveProperty("X-Client-IP");
      expect(init.headers).not.toHaveProperty("X-Internal-Auth");
    }
    vi.unstubAllEnvs();
  });

  it("names a refusal for too many attempts", async () => {
    answer(429, { detail: "Too many requests" });
    await expect(authorize(creds)).rejects.toMatchObject({ code: "rate_limited" });
  });
});
