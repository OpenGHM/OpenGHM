import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", () => ({ BACKEND_URL: "http://backend.test" }));

import { GET } from "./route";
import { GET as inventory } from "../route";

const ID = "a".repeat(64);
const call = (query: string, id = ID) =>
  GET(new Request(`http://app.test/api/repository/datasets/${id}/output/subset?${query}`), {
    params: Promise.resolve({ id }),
  });

afterEach(() => vi.unstubAllGlobals());

describe("the subset download route", () => {
  it("asks the backend with only the subset's own parameters and streams the file through", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("netcdf", {
        headers: {
          "content-type": "application/x-netcdf",
          "content-disposition": 'attachment; filename="a.nc"',
          "content-length": "6",
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await call("variable=runoff&resolution=yearly&start=2000&bbox=1,2,3,4&evil=x");
    const asked = new URL(fetchMock.mock.calls[0][0]);
    expect(asked.pathname).toBe(`/api/v1/repository/datasets/${ID}/output/subset`);
    expect(Object.fromEntries(asked.searchParams)).toEqual({
      variable: "runoff",
      resolution: "yearly",
      start: "2000",
      bbox: "1,2,3,4",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="a.nc"');
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe("netcdf");
  });

  it("passes a refusal through, status and JSON", async () => {
    const body = { detail: { code: "output_request_refused", message: "too much" } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body, { status: 422 })));
    const res = await call("variable=runoff&resolution=daily");
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual(body);
  });

  it("does not ask the backend for an id that is not a snapshot's, and says when it is unreachable", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    expect((await call("variable=x&resolution=yearly", "../jobs")).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await call("variable=x&resolution=yearly")).status).toBe(502);
  });
});

describe("the output inventory route", () => {
  it("passes the inventory through, kept for an hour, and a refusal not at all", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ variables: [] })));
    const ok = await inventory(new Request("http://app.test/x"), { params: Promise.resolve({ id: ID }) });
    expect(ok.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(await ok.json()).toEqual({ variables: [] });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ detail: "x" }, { status: 503 })));
    const down = await inventory(new Request("http://app.test/x"), { params: Promise.resolve({ id: ID }) });
    expect(down.status).toBe(503);
    expect(down.headers.get("cache-control")).toBe("no-store");
  });
});
