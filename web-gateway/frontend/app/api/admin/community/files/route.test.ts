// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { auth, getBackendAuth } = vi.hoisted(() => ({ auth: vi.fn(), getBackendAuth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/api-client", () => ({ BACKEND_URL: "http://backend.test", getBackendAuth }));

import { POST } from "./route";

const BOUNDARY = "----test";

/** A multipart request, as the browser sends an upload. */
function upload(options: { contentType?: string; contentLength?: string | null; body?: string | null } = {}) {
  const body = options.body === undefined ? `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\n\r\nxyz\r\n--${BOUNDARY}--\r\n` : options.body;
  const headers: Record<string, string> = {
    "content-type": options.contentType ?? `multipart/form-data; boundary=${BOUNDARY}`,
  };
  if (options.contentLength !== null) headers["content-length"] = options.contentLength ?? String(body?.length ?? 0);
  return new Request("http://app.test/api/admin/community/files", { method: "POST", headers, body, duplex: "half" } as RequestInit);
}

beforeEach(() => {
  auth.mockReset();
  getBackendAuth.mockReset();
  auth.mockResolvedValue({ user: { role: "admin" } });
  getBackendAuth.mockResolvedValue({ headers: { Authorization: "Bearer t" }, authenticated: true });
});
afterEach(() => vi.unstubAllGlobals());

describe("the community upload route", () => {
  it("answers 401 session_expired without calling the backend when there is no session", async () => {
    getBackendAuth.mockResolvedValue({ headers: {}, authenticated: false });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await POST(upload());
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "session_expired" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 403 to an account that is not an admin, without calling the backend", async () => {
    auth.mockResolvedValue({ user: { role: "staff" } });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await POST(upload());
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses what is not multipart, and a body that says it is over the limit", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await POST(upload({ contentType: "application/json" }))).status).toBe(415);
    const big = await POST(upload({ contentLength: String(26 * 1024 * 1024 + 70 * 1024) }));
    expect(big.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes the body to the backend with the session's token and the multipart type, and returns its answer", async () => {
    const stored = { id: "0123456789abcdef01234567", url: "/api/community/files/0123456789abcdef01234567" };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(stored), { status: 201, headers: { "content-type": "application/json" } })
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await POST(upload());
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(stored);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://backend.test/api/v1/admin/community/files");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer t");
    expect(init.headers["Content-Type"]).toContain(`boundary=${BOUNDARY}`);
    expect(init.duplex).toBe("half");
    expect(init.body).toBeInstanceOf(ReadableStream);
  });

  it("returns the backend's refusal unchanged: status and body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: { code: "unsupported_type", message: "No SVG." } }), {
          status: 415,
          headers: { "content-type": "application/json" },
        })
      )
    );
    const res = await POST(upload());
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ detail: { code: "unsupported_type", message: "No SVG." } });
  });

  it("answers 502 when the backend cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const res = await POST(upload());
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: "gateway_unreachable" });
  });
});
