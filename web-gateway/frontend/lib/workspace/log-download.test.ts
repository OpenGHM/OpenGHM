import { describe, expect, it } from "vitest";
import { filenameFromDisposition, messageFromErrorBody } from "@/lib/workspace/log-download";

describe("filenameFromDisposition", () => {
  it("reads the quoted name the backend sends", () => {
    expect(filenameFromDisposition('attachment; filename="sim-1-wbm.log"', "x.log")).toBe("sim-1-wbm.log");
  });
  it("prefers the UTF-8 form", () => {
    expect(filenameFromDisposition("attachment; filename*=UTF-8''sim%201.log", "x.log")).toBe("sim 1.log");
  });
  it("reads an unquoted name", () => {
    expect(filenameFromDisposition("attachment; filename=a.log", "x.log")).toBe("a.log");
  });
  it("falls back when there is none", () => {
    expect(filenameFromDisposition(null, "x.log")).toBe("x.log");
    expect(filenameFromDisposition("attachment", "x.log")).toBe("x.log");
  });
});

describe("messageFromErrorBody", () => {
  it("reads the backend's nested detail, the route's own shape, and a plain detail", () => {
    const message = "This log is 73.2 MB, above the 50 MB download limit. It is on Anvil at /x.";
    expect(messageFromErrorBody({ detail: { code: "log_too_large", message } }, "f")).toBe(message);
    expect(messageFromErrorBody({ code: "session_expired", message: "Sign in again." }, "f")).toBe("Sign in again.");
    expect(messageFromErrorBody({ detail: "Not found" }, "f")).toBe("Not found");
  });
  it("falls back for anything else", () => {
    expect(messageFromErrorBody(null, "f")).toBe("f");
    expect(messageFromErrorBody({}, "f")).toBe("f");
    expect(messageFromErrorBody("text", "f")).toBe("f");
  });
});
