// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ARCHIVE_RETRY_DELAYS_MS, fetchArchive } from "./archive-fetch";

const busy = () => Response.json({ detail: { code: "archive_busy", message: "busy" } }, { status: 429 });
const zip = () => new Response("PK-zip", { headers: { "content-length": "6" } });
const INIT = { method: "POST", body: '{"folder":"","names":["a"]}', cache: "no-store" } as const;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("fetchArchive", () => {
  it("waits 500 ms, then 1500 ms, by default", () => {
    expect(ARCHIVE_RETRY_DELAYS_MS).toEqual([500, 1500]);
  });

  it("returns a first answer that is not a refusal as it is, with one call", async () => {
    const fetchMock = vi.fn().mockResolvedValue(zip());
    vi.stubGlobal("fetch", fetchMock);
    const res = await fetchArchive("http://backend.test/a", INIT);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("PK-zip");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends the same request again after 429 archive_busy, once the first wait is over, and returns the ZIP", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(busy()).mockResolvedValueOnce(zip());
    vi.stubGlobal("fetch", fetchMock);
    const pending = fetchArchive("http://backend.test/a", INIT);
    await vi.advanceTimersByTimeAsync(499);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    const res = await pending;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe("6");
    expect(await res.text()).toBe("PK-zip");
    // The very same url and init, the body a string that can be sent again.
    expect(fetchMock.mock.calls[1]).toEqual(["http://backend.test/a", INIT]);
    expect(fetchMock.mock.calls[0][1]).toBe(fetchMock.mock.calls[1][1]);
  });

  it("waits 1500 ms before the second retry", async () => {
    const fetchMock = vi.fn().mockImplementationOnce(async () => busy()).mockImplementationOnce(async () => busy()).mockResolvedValueOnce(zip());
    vi.stubGlobal("fetch", fetchMock);
    const pending = fetchArchive("http://backend.test/a", INIT);
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1499);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("returns the third 429 unchanged, status and body, after three calls", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => busy());
    vi.stubGlobal("fetch", fetchMock);
    const pending = fetchArchive("http://backend.test/a", INIT);
    await vi.advanceTimersByTimeAsync(2000);
    const res = await pending;
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ detail: { code: "archive_busy", message: "busy" } });
  });

  it.each([
    [413, { detail: { code: "selection_too_large" } }],
    [404, { detail: { code: "not_found" } }],
    [422, { detail: [] }],
    [503, { detail: { code: "anvil_unreachable" } }],
    [429, { detail: { code: "rate_limited" } }],
    [429, { detail: "archive_busy" }],
  ])("does not retry %i %j", async (status, body) => {
    const fetchMock = vi.fn().mockImplementation(async () => Response.json(body, { status }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await fetchArchive("http://backend.test/a", INIT);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual(body);
  });

  it("does not retry a 429 whose body is not JSON, and leaves it readable", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response("slow down", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await fetchArchive("http://backend.test/a", INIT);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await res.text()).toBe("slow down");
  });

  it("lets a network error through as it is, without a retry", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchArchive("http://backend.test/a", INIT)).rejects.toThrow("fetch failed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("lets a network error on a retry through too", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(busy()).mockRejectedValueOnce(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    const pending = fetchArchive("http://backend.test/a", INIT);
    const settled = expect(pending).rejects.toThrow("fetch failed");
    await vi.advanceTimersByTimeAsync(500);
    await settled;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops at once when the signal is aborted during a wait, with the signal's reason and no further call", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => busy());
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const pending = fetchArchive("http://backend.test/a", { ...INIT, signal: controller.signal });
    const settled = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(200);
    controller.abort();
    await settled;
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not wait at all when the signal is already aborted by the time of the refusal", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockImplementation(async () => {
      controller.abort();
      return busy();
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchArchive("http://backend.test/a", { ...INIT, signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("takes its delays from the options: none means no retry", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => busy());
    vi.stubGlobal("fetch", fetchMock);
    expect((await fetchArchive("http://backend.test/a", INIT, { delaysMs: [] })).status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const pending = fetchArchive("http://backend.test/a", INIT, { delaysMs: [1, 1, 1] });
    await vi.advanceTimersByTimeAsync(3);
    await pending;
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});
