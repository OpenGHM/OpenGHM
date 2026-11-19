import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MEMORY_LIMIT_BYTES, chooseWhere, failureMessage, runDownload, type DownloadState } from "./engine";

const BIG = MEMORY_LIMIT_BYTES + 1;

describe("chooseWhere", () => {
  it("writes a big download to disk when the browser has the picker, else hands it to the browser, else holds it", () => {
    expect(chooseWhere({ expectedBytes: BIG, native: true }, true)).toBe("disk");
    expect(chooseWhere({ expectedBytes: BIG, native: true }, false)).toBe("native");
    expect(chooseWhere({ expectedBytes: BIG, native: false }, false)).toBe("memory");
  });

  it("hands a big public object to the browser as a link when the picker is missing", () => {
    expect(chooseWhere({ expectedBytes: BIG, direct: true }, false)).toBe("native");
    expect(chooseWhere({ expectedBytes: BIG, direct: true }, true)).toBe("disk");
  });

  it("holds a small or unknown size in memory", () => {
    expect(chooseWhere({ expectedBytes: 1000, native: true }, true)).toBe("memory");
    expect(chooseWhere({ expectedBytes: null, native: true }, true)).toBe("memory");
    expect(chooseWhere({ native: true }, true)).toBe("memory");
  });
});

describe("failureMessage", () => {
  it("uses the refusal's own words, a session message for 401, and a plain one otherwise", () => {
    expect(failureMessage(429, { detail: { message: "Other downloads are being prepared." } })).toBe(
      "Other downloads are being prepared."
    );
    expect(failureMessage(401, null)).toMatch(/session has expired/);
    expect(failureMessage(502, null)).toMatch(/could not be prepared/);
  });
});

function stream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(chunks[i++]);
      else controller.close();
    },
  });
}

describe("runDownload through memory", () => {
  const states: DownloadState[] = [];
  const report = (s: DownloadState) => states.push(s);
  const saved: string[] = [];

  beforeEach(() => {
    states.length = 0;
    saved.length = 0;
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() }));
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      saved.push(this.download);
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("prepares, reads the body with progress, and saves under the name the response gives", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(stream([new Uint8Array(3), new Uint8Array(2)]), {
          headers: { "content-length": "5", "content-disposition": 'attachment; filename="run-files.zip"' },
        })
      )
    );
    await runDownload({ title: "t", filename: "fallback.zip", url: "/x" }, new AbortController().signal, report);
    expect(states[0]).toEqual({ phase: "preparing" });
    expect(states.at(-1)).toEqual({ phase: "done", filename: "run-files.zip" });
    expect(saved).toEqual(["run-files.zip"]);
  });

  it("sends a POST's fields as a form body", async () => {
    const fetchMock = vi.fn(async () => new Response(stream([new Uint8Array(1)]), { headers: { "content-length": "1" } }));
    vi.stubGlobal("fetch", fetchMock);
    await runDownload(
      { title: "t", filename: "a.zip", url: "/archive", method: "POST", fields: [["folder", "d/"], ["names", "a"], ["names", "b"]] },
      new AbortController().signal,
      report
    );
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.method).toBe("POST");
    expect(String(init.body)).toBe("folder=d%2F&names=a&names=b");
  });

  it("reports the refusal's message and saves nothing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ detail: { message: "Select less." } }, { status: 413 }))
    );
    await runDownload({ title: "t", filename: "a.zip", url: "/x" }, new AbortController().signal, report);
    expect(states.at(-1)).toEqual({ phase: "failed", message: "Select less." });
    expect(saved).toEqual([]);
  });

  it("fails, and saves nothing, when the body ends short of its length", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(stream([new Uint8Array(3)]), { headers: { "content-length": "9" } }))
    );
    await runDownload({ title: "t", filename: "a.zip", url: "/x" }, new AbortController().signal, report);
    expect(states.at(-1)?.phase).toBe("failed");
    expect(saved).toEqual([]);
  });

  it("reports nothing more once stopped", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        controller.abort();
        throw Object.assign(new Error("aborted"), { name: "AbortError", signal: init.signal });
      })
    );
    await runDownload({ title: "t", filename: "a.zip", url: "/x" }, controller.signal, report);
    expect(states).toEqual([{ phase: "preparing" }]);
  });
});
