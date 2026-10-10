// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));

import { requireSession, workspaceSession } from "@/lib/auth-guard";

beforeEach(() => auth.mockReset());

describe("workspaceSession", () => {
  it("says there is no session when nobody is signed in", async () => {
    auth.mockResolvedValue(null);
    expect(await workspaceSession()).toEqual({ signedOut: "none" });
  });

  it("says the session ended when its token refresh failed", async () => {
    auth.mockResolvedValue({ user: { id: "u1" }, error: "RefreshTokenError" });
    expect(await workspaceSession()).toEqual({ signedOut: "expired" });
  });

  it("returns the session when it is good", async () => {
    const session = { user: { id: "u1" } };
    auth.mockResolvedValue(session);
    expect(await workspaceSession()).toEqual({ session });
  });

  it("never redirects", async () => {
    auth.mockResolvedValue(null);
    await expect(workspaceSession()).resolves.toBeDefined();
  });
});

describe("requireSession", () => {
  it("still redirects to sign-in, back to the page, when signed out", async () => {
    auth.mockResolvedValue(null);
    await expect(requireSession("/dev/workspace/x?a=1")).rejects.toThrow(
      "redirect:/auth/signin?callbackUrl=%2Fdev%2Fworkspace%2Fx%3Fa%3D1"
    );
  });
});
