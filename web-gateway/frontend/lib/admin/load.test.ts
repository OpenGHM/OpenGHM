import { describe, expect, it, vi } from "vitest";

const { redirectToSignIn } = vi.hoisted(() => ({
  redirectToSignIn: vi.fn((to: string) => {
    throw new Error(`SIGN_IN ${to}`);
  }),
}));
vi.mock("@/lib/auth-guard", () => ({
  redirectToSignIn,
  isUnauthorizedError: (e: unknown) => (e as { response?: { status?: number } })?.response?.status === 401,
}));

import { loadOrSignIn, signInIfUnauthorized } from "@/lib/admin/load";

const unauthorized = Object.assign(new Error("401"), { response: { status: 401 } });
const broken = Object.assign(new Error("500"), { response: { status: 500 } });

describe("loadOrSignIn", () => {
  it("returns what the read returned", async () => {
    await expect(loadOrSignIn("/admin/users", async () => 7)).resolves.toBe(7);
  });

  it("sends a 401 to sign in, back to this page", async () => {
    await expect(loadOrSignIn("/admin/users?page=3", () => Promise.reject(unauthorized))).rejects.toThrow(
      "SIGN_IN /admin/users?page=3"
    );
  });

  it("answers null to any other failure, for the page to say so", async () => {
    redirectToSignIn.mockClear();
    await expect(loadOrSignIn("/admin/users", () => Promise.reject(broken))).resolves.toBeNull();
    expect(redirectToSignIn).not.toHaveBeenCalled();
  });
});

describe("signInIfUnauthorized", () => {
  it("redirects when any of the reads was a 401, and not for other failures", async () => {
    const ok = await Promise.allSettled([Promise.resolve(1), Promise.reject(broken)]);
    expect(() => signInIfUnauthorized("/admin", ok)).not.toThrow();
    const expired = await Promise.allSettled([Promise.resolve(1), Promise.reject(unauthorized)]);
    expect(() => signInIfUnauthorized("/admin", expired)).toThrow("SIGN_IN /admin");
  });
});
