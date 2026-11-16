import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ value: { authenticated: true, headers: { Authorization: "Bearer t" } } as unknown }));
vi.mock("@/lib/api-client", () => ({ BACKEND_URL: "http://backend.test", getBackendAuth: async () => auth.value }));

import { GET as inventory } from "./route";
import { GET as map } from "./map/route";
import { GET as series } from "./series/route";
import { GET as subset } from "./subset/route";
import { GET as datasetMap } from "../../../repository/datasets/[id]/output/map/route";
import { GET as datasetSeries } from "../../../repository/datasets/[id]/output/series/route";

const JOB = "job-1";
const SNAP = "b".repeat(64);
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (path: string) => new Request(`http://app.test${path}`);

beforeEach(() => {
  auth.value = { authenticated: true, headers: { Authorization: "Bearer t" } };
});
afterEach(() => vi.unstubAllGlobals());

describe("a job's output routes", () => {
  it("ask the backend as the signed-in user, with only the route's own parameters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ base64: "x" }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await map(
      req(`/api/jobs/${JOB}/output/map?variable=runoff&resolution=yearly&start=2000&ramp=DarkBlue&min=0&max=5&log=true&image=webp&projection=mercator&evil=1&encoding=png`),
      ctx(JOB)
    );
    const [url, init] = fetchMock.mock.calls[0];
    const asked = new URL(url);
    expect(asked.pathname).toBe(`/api/v1/jobs/${JOB}/output/map`);
    expect(Object.fromEntries(asked.searchParams)).toEqual({
      variable: "runoff",
      resolution: "yearly",
      start: "2000",
      ramp: "DarkBlue",
      min: "0",
      max: "5",
      log: "true",
      image: "webp",
      projection: "mercator",
      encoding: "json",
    });
    expect(init.headers).toEqual({ Authorization: "Bearer t" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("answer 401 without asking the backend when there is no session", async () => {
    auth.value = { authenticated: false, headers: {} };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await inventory(req("/x"), ctx(JOB))).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pass the series parameters and a refusal through, status and JSON", async () => {
    const body = { detail: { code: "output_request_refused", message: "over a year" } };
    const fetchMock = vi.fn().mockResolvedValue(Response.json(body, { status: 422 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await series(req(`/x?variable=a&resolution=daily&point=1,2&start=2000&end=2003&display=true`), ctx(JOB));
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get("point")).toBe("1,2");
    expect(new URL(fetchMock.mock.calls[0][0]).pathname).toBe(`/api/v1/jobs/${JOB}/output/series`);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual(body);
  });

  it("stream a subset with its file headers, and say when the backend is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("nc", { headers: { "content-type": "application/x-netcdf", "content-disposition": 'attachment; filename="a.nc"', "content-length": "2" } })
      )
    );
    const ok = await subset(req("/x?variable=a&resolution=yearly"), ctx(JOB));
    expect(ok.headers.get("content-disposition")).toBe('attachment; filename="a.nc"');
    expect(await ok.text()).toBe("nc");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("down")));
    expect((await subset(req("/x?variable=a&resolution=yearly"), ctx(JOB))).status).toBe(502);
  });
});

describe("a snapshot's map and series routes", () => {
  it("are open, cached for an hour when they answer, and refuse an id that is not a snapshot's", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ base64: "x" }));
    vi.stubGlobal("fetch", fetchMock);
    const ok = await datasetMap(req("/x?variable=a&resolution=yearly&start=2000"), ctx(SNAP));
    expect(new URL(fetchMock.mock.calls[0][0]).pathname).toBe(`/api/v1/repository/datasets/${SNAP}/output/map`);
    expect(fetchMock.mock.calls[0][1].headers).toBeUndefined();
    expect(ok.headers.get("cache-control")).toBe("public, max-age=3600");
    fetchMock.mockClear();
    expect((await datasetSeries(req("/x?variable=a&resolution=yearly&point=1,2"), ctx("../jobs"))).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
