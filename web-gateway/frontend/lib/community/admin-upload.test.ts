import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_UPLOAD_BYTES } from "@/lib/community/admin-format";
import { uploadCommunityFile, uploadErrorMessage, UPLOAD_URL } from "@/lib/community/admin-upload";

/** A stand-in for XMLHttpRequest that answers with what the test sets. */
class FakeXhr {
  static last: FakeXhr;
  static reply: { status: number; body: string } = { status: 201, body: "{}" };
  method = "";
  url = "";
  responseType = "";
  status = 0;
  responseText = "";
  sent: FormData | null = null;
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  send(form: FormData) {
    this.sent = form;
    queueMicrotask(() => {
      this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 });
      this.status = FakeXhr.reply.status;
      this.responseText = FakeXhr.reply.body;
      this.onload?.();
    });
  }
  abort() {
    this.onabort?.();
  }
}

const file = (name: string, size = 10) => {
  const f = new File(["x"], name, { type: "application/octet-stream" });
  Object.defineProperty(f, "size", { value: size });
  return f;
};

const stored = {
  id: "0123456789abcdef01234567",
  url: "/api/community/files/0123456789abcdef01234567",
  filename: "a.png",
  content_type: "image/png",
  size: 10,
  uploaded_at: "2026-10-10T00:00:00Z",
};

beforeEach(() => {
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  FakeXhr.reply = { status: 201, body: JSON.stringify(stored) };
});
afterEach(() => vi.unstubAllGlobals());

describe("uploadCommunityFile", () => {
  it("posts the file as the `file` field to the gateway's route and reports progress", async () => {
    const onProgress = vi.fn();
    const result = await uploadCommunityFile(file("a.png"), { kind: "image", onProgress });
    expect(result).toEqual({ ok: true, file: stored });
    expect(FakeXhr.last.method).toBe("POST");
    expect(FakeXhr.last.url).toBe(UPLOAD_URL);
    expect((FakeXhr.last.sent?.get("file") as File).name).toBe("a.png");
    expect(onProgress).toHaveBeenCalledWith(0.5);
  });

  it("refuses a file over 25 MiB before sending anything", async () => {
    FakeXhr.last = undefined as never;
    const result = await uploadCommunityFile(file("big.mp4", MAX_UPLOAD_BYTES + 1), { kind: "file" });
    expect(result).toMatchObject({ ok: false, reason: "error", message: expect.stringMatching(/limit is 25 MB/) });
    expect(FakeXhr.last).toBeUndefined();
  });

  it("refuses a type that is not allowed before sending anything", async () => {
    const result = await uploadCommunityFile(file("a.svg"), { kind: "image" });
    expect(result).toMatchObject({ ok: false, reason: "error" });
  });

  it("answers an ended session as session_expired", async () => {
    FakeXhr.reply = { status: 401, body: JSON.stringify({ code: "session_expired", message: "x" }) };
    expect(await uploadCommunityFile(file("a.png"), { kind: "image" })).toEqual({ ok: false, reason: "session_expired" });
  });

  it("carries the backend's sentence for a 415, and a fixed one for a 413", async () => {
    FakeXhr.reply = { status: 415, body: JSON.stringify({ detail: { code: "unsupported_type", message: "Only images." } }) };
    expect(await uploadCommunityFile(file("a.png"), { kind: "image" })).toMatchObject({ message: "Only images.", status: 415 });
    FakeXhr.reply = { status: 413, body: "{}" };
    expect(await uploadCommunityFile(file("a.png"), { kind: "image" })).toMatchObject({ message: expect.stringMatching(/over the 25 MB limit/), status: 413 });
  });

  it("does not take a 201 without a file address for success", async () => {
    FakeXhr.reply = { status: 201, body: "not json" };
    expect(await uploadCommunityFile(file("a.png"), { kind: "image" })).toMatchObject({ ok: false, reason: "error" });
  });
});

describe("uploadErrorMessage", () => {
  it("reads the plain-string and the object forms of a detail", () => {
    expect(uploadErrorMessage(500, { detail: "Disk full." })).toBe("Disk full.");
    expect(uploadErrorMessage(502, { code: "gateway_unreachable", message: "Try later." })).toBe("Try later.");
    expect(uploadErrorMessage(403, null)).toBe("Only admins can upload files.");
    expect(uploadErrorMessage(0, null)).toMatch(/could not reach/);
    expect(uploadErrorMessage(400, null)).toBe("The file could not be uploaded.");
  });
});
