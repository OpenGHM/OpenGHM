import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getBackendAuth } = vi.hoisted(() => ({ getBackendAuth: vi.fn() }));
vi.mock("@/lib/api-client", () => ({
  BACKEND_URL: "http://backend.test",
  getBackendAuth,
}));

import { GET } from "./route";

const call = (stream: string, id = "job 1") =>
  GET(new Request("http://app.test/x"), { params: Promise.resolve({ id, stream }) });

beforeEach(() => {
  getBackendAuth.mockReset();
  getBackendAuth.mockResolvedValue({ headers: { Authorization: "Bearer t" }, authenticated: true });
});
afterEach(() => vi.unstubAllGlobals());

describe("the log download route", () => {
  it("refuses a stream that is not one of the three", async () => {
    const res = await call("secrets");
    expect(res.status).toBe(400);
  });

  it("answers 401 session_expired without calling the backend when there is no session", async () => {
    getBackendAuth.mockResolvedValue({ headers: {}, authenticated: false });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await call("wbm");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      code: "session_expired",
      message: "Your session has expired. Sign in again.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("streams the backend's file through with its name and length, sending the session's token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("the log", {
        status: 200,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "content-disposition": 'attachment; filename="sim-1-wbm.log"',
          "content-length": "7",
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await call("wbm");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://backend.test/api/v1/jobs/job%201/logs/wbm/download",
      expect.objectContaining({ headers: { Authorization: "Bearer t" } })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="sim-1-wbm.log"');
    expect(res.headers.get("content-length")).toBe("7");
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await res.text()).toBe("the log");
  });

  it("passes the backend's refusal through with its status and JSON", async () => {
    const body = { detail: { code: "log_too_large", message: "This log is 73.2 MB. It is on Anvil at /x.", size: 1, max: 0 } };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(body), { status: 413, headers: { "content-type": "application/json" } })
      )
    );
    const res = await call("stderr");
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual(body);
    expect(res.headers.get("content-disposition")).toBeNull();
  });

  it("says so when the backend cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const res = await call("stdout");
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("gateway_unreachable");
  });
});
