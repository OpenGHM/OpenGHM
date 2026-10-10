import { describe, expect, it } from "vitest";
import { adminFailure, splitFieldErrors } from "@/lib/community/admin-failure";

const refused = (status: number, detail: unknown) => ({ response: { status, data: { detail } } });

describe("adminFailure", () => {
  it("reads an ended session and a missing item", () => {
    expect(adminFailure(refused(401, "Not signed in."))).toEqual({ ok: false, reason: "session_expired" });
    expect(adminFailure(refused(404, "Not found"))).toEqual({ ok: false, reason: "not_found" });
  });

  it("gives each field of a 422 its own message", () => {
    const failure = adminFailure(
      refused(422, [
        { loc: ["body", "title"], msg: "Field required", type: "missing" },
        { loc: ["body", "details", 1, "label"], msg: "String should have at least 1 character", type: "x" },
      ])
    );
    expect(failure).toMatchObject({
      ok: false,
      reason: "error",
      status: 422,
      errors: [
        { path: "title", message: "Field required" },
        { path: "details.1.label", message: "String should have at least 1 character" },
      ],
    });
  });

  it("keeps a validation error's `errors` list when the backend sends one", () => {
    const failure = adminFailure(
      refused(422, { code: "invalid_content", message: "Not saved.", errors: [{ path: "body", message: "No tables." }] })
    );
    expect(failure).toMatchObject({ errors: [{ path: "body", message: "No tables." }] });
  });

  it("puts a 409 slug_taken on the slug", () => {
    const failure = adminFailure(refused(409, { code: "slug_taken", message: "That slug is already used." }));
    expect(failure).toMatchObject({
      status: 409,
      code: "slug_taken",
      errors: [{ path: "slug", message: "That slug is already used." }],
    });
  });

  it("reads a 413, a 415 and a 403 as sentences", () => {
    expect(adminFailure(refused(413, "File too large"))).toMatchObject({ status: 413, message: "File too large" });
    expect(adminFailure(refused(403, { code: "permission_required", message: "Requires permission: content:manage" }))).toMatchObject({
      status: 403,
      code: "permission_required",
    });
  });

  it("reads no answer at all as unreachable", () => {
    expect(adminFailure({ isAxiosError: true, message: "", code: "ECONNREFUSED" })).toMatchObject({
      reason: "error",
      code: "backend_unreachable",
    });
  });
});

describe("splitFieldErrors", () => {
  const base = { ok: false as const, reason: "error" as const, message: "Request failed." };

  it("splits messages beside fields from the rest", () => {
    expect(
      splitFieldErrors({
        ...base,
        errors: [
          { path: "title", message: "Too long." },
          { path: "title", message: "Also odd." },
          { path: null, message: "Something general." },
        ],
      })
    ).toEqual({ fields: { title: "Too long. Also odd." }, general: ["Something general."] });
  });

  it("keeps the one sentence when no field is named", () => {
    expect(splitFieldErrors({ ...base, message: "Server hiccup." })).toEqual({ fields: {}, general: ["Server hiccup."] });
  });
});
