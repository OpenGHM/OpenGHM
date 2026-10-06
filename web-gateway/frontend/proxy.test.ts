// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

// `auth(callback)` is next-auth's wrapper; here it hands the callback back so
// the proxy's own decision can be called with a request of any session.
vi.mock("@/lib/auth", () => ({ auth: (callback: unknown) => callback }));

import proxy from "./proxy";

type Handler = (req: unknown) => Response;

function request(opts: { path: string; auth: unknown; action?: boolean }) {
  const url = new URL(`http://localhost:3100${opts.path}`);
  return {
    nextUrl: url,
    auth: opts.auth,
    headers: new Headers(opts.action ? { "next-action": "abc123" } : {}),
  };
}

const call = (req: ReturnType<typeof request>) => (proxy as unknown as Handler)(req);

describe("proxy", () => {
  it("redirects a signed-out visit to a protected page to sign in, keeping the query", () => {
    const res = call(request({ path: "/workspace?status=FAILED", auth: null }));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "http://localhost:3100/auth/signin?callbackUrl=%2Fworkspace%3Fstatus%3DFAILED"
    );
  });

  it("lets a server action through when there is no session at all (signed out in another tab)", () => {
    const res = call(request({ path: "/workspace/jobs/j1", auth: null, action: true }));
    expect(res.headers.get("location")).toBeNull();
  });

  it("lets a server action through when the session's token could not be refreshed", () => {
    const res = call(request({ path: "/workspace/jobs/j1", auth: { error: "RefreshTokenError" }, action: true }));
    expect(res.headers.get("location")).toBeNull();
  });

  it("still redirects a page navigation whose session expired", () => {
    const res = call(request({ path: "/admin/jobs", auth: { error: "RefreshTokenError" } }));
    expect(res.headers.get("location")).toContain("/auth/signin");
  });
});
