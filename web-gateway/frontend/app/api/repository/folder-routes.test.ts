// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", () => ({ BACKEND_URL: "http://backend.test" }));

import { POST as snapshotArchive } from "./datasets/[id]/files/archive/route";
import { GET as snapshotFolder } from "./datasets/[id]/files/folder/route";
import { POST as modelInputArchive } from "./model-inputs/[id]/files/archive/route";
import { GET as modelInputFolder } from "./model-inputs/[id]/files/folder/route";

const ID = "a".repeat(64);
const params = (id: string) => ({ params: Promise.resolve({ id }) });

function form(folder: string | null, names: string[]): Request {
  const body = new URLSearchParams();
  if (folder !== null) body.set("folder", folder);
  for (const name of names) body.append("names", name);
  return new Request(`http://app.test/api/repository/x/${ID}/files/archive`, { method: "POST", body });
}

const folderCall = (route: typeof snapshotFolder, query: string, id = ID) =>
  route(new Request(`http://app.test/api/repository/x/${id}/files/folder?${query}`), params(id));

afterEach(() => vi.unstubAllGlobals());

describe("the archive routes", () => {
  it("forward a form's folder and names to the backend as JSON, and stream the ZIP through with its name and length", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("PK-zip-bytes", {
        headers: {
          "content-type": "application/zip",
          "content-disposition": `attachment; filename="${ID}-files.zip"`,
          "content-length": "12",
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await snapshotArchive(form("wbm_output/G/yearly/", ["a.nc", "sub/"]), params(ID));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`http://backend.test/api/v1/repository/datasets/${ID}/files/archive`);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({ folder: "wbm_output/G/yearly/", names: ["a.nc", "sub/"] });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="${ID}-files.zip"`);
    expect(res.headers.get("content-length")).toBe("12");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe("PK-zip-bytes");
  });

  it("pass the backend's body on as the very stream it is, not as a copy", async () => {
    const upstream = new Response(new ReadableStream({ start: (c) => c.close() }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(upstream));
    const res = await snapshotArchive(form("", ["a"]), params(ID));
    expect(res.body).toBe(upstream.body);
  });

  it("take a JSON body too, and the root as an empty folder", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("zip"));
    vi.stubGlobal("fetch", fetchMock);
    await snapshotArchive(
      new Request("http://app.test/x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ folder: "", names: ["metadata.json"] }),
      }),
      params(ID)
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ folder: "", names: ["metadata.json"] });
    await snapshotArchive(form(null, ["a"]), params(ID));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ folder: "", names: ["a"] });
  });

  it("send nothing but the folder and the names on, and hand the request's abort signal over", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("x"));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const body = new URLSearchParams({ folder: "d/", evil: "x" });
    body.append("names", "a");
    await snapshotArchive(
      new Request("http://app.test/x?path=y", { method: "POST", body, signal: controller.signal }),
      params(ID)
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ folder: "d/", names: ["a"] });
    const signal: AbortSignal = fetchMock.mock.calls[0][1].signal;
    expect(signal.aborted).toBe(false);
    controller.abort();
    expect(signal.aborted).toBe(true);
  });

  it("reach a model input's route under its own path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("zip"));
    vi.stubGlobal("fetch", fetchMock);
    await modelInputArchive(form("2020/", ["a"]), params(ID));
    expect(fetchMock.mock.calls[0][0]).toBe(`http://backend.test/api/v1/repository/model-inputs/${ID}/files/archive`);
  });

  it("pass a refusal through, status and JSON, without a download's headers", async () => {
    const body = { detail: { code: "selection_too_large", message: "too big", bytes: 600, limit_bytes: 500 } };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(body, { status: 413, headers: { "content-disposition": "attachment; filename=x.zip" } })
      )
    );
    const res = await snapshotArchive(form("", ["a"]), params(ID));
    expect(res.status).toBe(413);
    expect(res.headers.get("content-disposition")).toBeNull();
    expect(await res.json()).toEqual(body);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ detail: { code: "archive_busy" } }, { status: 429 })));
    expect((await snapshotArchive(form("", ["a"]), params(ID))).status).toBe(429);
  });

  it("refuse a body that is not a folder and names, without asking the backend", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const json = (value: unknown) =>
      snapshotArchive(
        new Request("http://app.test/x", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(value),
        }),
        params(ID)
      );
    for (const bad of [{ names: "a" }, { folder: 3, names: ["a"] }, { folder: "", names: [1] }, null]) {
      const res = await json(bad);
      expect(res.status).toBe(422);
      expect((await res.json()).code).toBe("invalid_selection");
    }
    const broken = await snapshotArchive(
      new Request("http://app.test/x", { method: "POST", headers: { "content-type": "application/json" }, body: "{" }),
      params(ID)
    );
    expect(broken.status).toBe(422);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("do not ask the backend for an id that is not one, and say when it is unreachable", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    expect((await snapshotArchive(form("", ["a"]), params("../jobs"))).status).toBe(404);
    expect((await modelInputArchive(form("", ["a"]), params("x"))).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await snapshotArchive(form("", ["a"]), params(ID))).status).toBe(502);
  });
});

describe("the folder summary routes", () => {
  it("pass the summary through as JSON, for both kinds, and ask the backend's summary route with the path only", async () => {
    const summary = { path: "daily/", url: "u", files: 2, bytes: 5, limit_bytes: 500, fits: true, complete: true };
    const fetchMock = vi.fn().mockImplementation(async () => Response.json(summary));
    vi.stubGlobal("fetch", fetchMock);
    for (const [route, segment] of [
      [snapshotFolder, "datasets"],
      [modelInputFolder, "model-inputs"],
    ] as const) {
      const res = await folderCall(route, "path=daily/&evil=x");
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("content-disposition")).toBeNull();
      expect(await res.json()).toEqual(summary);
      const asked = new URL(fetchMock.mock.lastCall![0]);
      expect(asked.pathname).toBe(`/api/v1/repository/${segment}/${ID}/files/folder`);
      expect(Object.fromEntries(asked.searchParams)).toEqual({ path: "daily/" });
    }
  });

  it("pass a refusal through, ask for the root when no path is given, and refuse a bad id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ detail: { code: "path_not_found" } }, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await folderCall(snapshotFolder, "");
    expect(res.status).toBe(404);
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get("path")).toBe("");
    expect((await folderCall(snapshotFolder, "path=a/", "nope")).status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
