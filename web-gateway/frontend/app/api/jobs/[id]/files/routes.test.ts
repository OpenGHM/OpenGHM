// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getBackendAuth } = vi.hoisted(() => ({ getBackendAuth: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ BACKEND_URL: "http://backend.test", getBackendAuth }));

import { GET as list } from "./route";
import { POST as archive } from "./archive/route";
import { GET as folder } from "./folder/route";

const params = (id = "job 1") => ({ params: Promise.resolve({ id }) });

function form(folderName: string | null, names: string[]): Request {
  const body = new URLSearchParams();
  if (folderName !== null) body.set("folder", folderName);
  for (const name of names) body.append("names", name);
  return new Request("http://app.test/api/jobs/job-1/files/archive", { method: "POST", body });
}

beforeEach(() => {
  getBackendAuth.mockReset();
  getBackendAuth.mockResolvedValue({ headers: { Authorization: "Bearer t" }, authenticated: true });
});
afterEach(() => vi.unstubAllGlobals());

describe("a run's file routes (ADR 0040)", () => {
  it("answer 401 session_expired without calling the backend when there is no session", async () => {
    getBackendAuth.mockResolvedValue({ headers: {}, authenticated: false });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const res of [
      await list(new Request("http://app.test/x?path=a/"), params()),
      await folder(new Request("http://app.test/x?path=a/"), params()),
      await archive(form("", ["a"]), params()),
    ]) {
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ code: "session_expired", message: "Your session has expired. Sign in again." });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pass a listing's path and cursor on, with the session's token, the job's id quoted", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ folders: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await list(new Request("http://app.test/x?path=monthly/&cursor=1000&evil=1"), params());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://backend.test/api/v1/jobs/job%201/files?path=monthly%2F&cursor=1000");
    expect(init.headers).toEqual({ Authorization: "Bearer t" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    await list(new Request("http://app.test/x"), params());
    expect(fetchMock.mock.calls[1][0]).toBe("http://backend.test/api/v1/jobs/job%201/files");
  });

  it("pass a folder's path on, and nothing else", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ fits: true }));
    vi.stubGlobal("fetch", fetchMock);
    await folder(new Request("http://app.test/x?path=daily/&cursor=2"), params());
    expect(fetchMock.mock.calls[0][0]).toBe("http://backend.test/api/v1/jobs/job%201/files/folder?path=daily%2F");
  });

  it("forward a form's folder and names as JSON with the token, and stream the ZIP through with its name and length", async () => {
    const upstream = new Response("PK-zip", {
      headers: {
        "content-type": "application/zip",
        "content-disposition": 'attachment; filename="sim-1-files.zip"',
        "content-length": "6",
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(upstream);
    vi.stubGlobal("fetch", fetchMock);
    const res = await archive(form("daily/", ["a.nc", "sub/"]), params());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://backend.test/api/v1/jobs/job%201/files/archive");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: "Bearer t", "Content-Type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({ folder: "daily/", names: ["a.nc", "sub/"] });
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="sim-1-files.zip"');
    expect(res.headers.get("content-length")).toBe("6");
    expect(res.body).toBe(upstream.body);
  });

  it("refuse a body that is not a folder and names with 422, and ask nothing of the backend", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await archive(
      new Request("http://app.test/x", { method: "POST", headers: { "content-type": "application/json" }, body: "[1]" }),
      params()
    );
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("invalid_selection");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [409, "run_not_finished"],
    [410, "output_purged"],
    [413, "selection_too_large"],
    [429, "archive_busy"],
    [503, "anvil_unreachable"],
  ])("pass the backend's %i %s on unchanged", async (status, code) => {
    const body = { detail: { code, message: "plain words" } };
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json(body, { status })));
    for (const res of [
      await folder(new Request("http://app.test/x?path=a/"), params()),
      await archive(form("", ["a"]), params()),
    ]) {
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual(body);
      expect(res.headers.get("content-disposition")).toBeNull();
    }
  });

  it("answer 502 when the backend cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("refused")));
    const res = await list(new Request("http://app.test/x"), params());
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("gateway_unreachable");
  });
});
