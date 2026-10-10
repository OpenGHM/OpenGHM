import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", () => ({ BACKEND_URL: "http://backend.test" }));

import { GET } from "./route";

const ID = "65f1a2b3c4d5e6f708192a3b";
const call = (id: string) => GET(new Request("http://app.test/x"), { params: Promise.resolve({ id }) });

afterEach(() => vi.unstubAllGlobals());

describe("the Community file route", () => {
  it.each(["abc", "65F1A2B3C4D5E6F708192A3B", `${ID}0`, "../etc/passwd", "65f1a2b3c4d5e6f708192a3g", ""])(
    "answers 404 without calling the backend when the id is %j",
    async (id) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const res = await call(id);
      expect(res.status).toBe(404);
      expect((await res.json()).code).toBe("file_not_found");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it("streams the backend's bytes through with the headers that matter, sending no credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("PNGDATA", {
        status: 200,
        headers: {
          "content-type": "image/png",
          "content-disposition": 'inline; filename="cover.png"',
          "content-length": "7",
          "cache-control": "public, max-age=31536000, immutable",
          "x-content-type-options": "nosniff",
          "set-cookie": "leak=1",
          "x-internal": "no",
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await call(ID);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`http://backend.test/api/v1/community/files/${ID}`);
    expect(init.headers).toBeUndefined();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-disposition")).toBe('inline; filename="cover.png"');
    expect(res.headers.get("content-length")).toBe("7");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("x-internal")).toBeNull();
    expect(await res.text()).toBe("PNGDATA");
  });

  it("adds nosniff even when the backend left it out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("x", { status: 200, headers: { "content-type": "text/plain" } }))
    );
    const res = await call(ID);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("passes the backend's 404 through and never lets it be cached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: "File not found" }), {
          status: 404,
          headers: { "content-type": "application/json", "cache-control": "public, max-age=31536000" },
        })
      )
    );
    const res = await call(ID);
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-disposition")).toBeNull();
    expect(await res.json()).toEqual({ detail: "File not found" });
  });

  it("says so when the backend cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const res = await call(ID);
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("gateway_unreachable");
  });
});
