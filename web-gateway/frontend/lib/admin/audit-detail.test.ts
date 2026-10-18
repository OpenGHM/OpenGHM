import { describe, expect, it } from "vitest";
import { detailPairs, detailView } from "@/lib/admin/audit-detail";
import { auditHref, parseDay } from "@/lib/admin/audit-href";

describe("an audit event's detail", () => {
  it("reads as key: value pairs, strings plain and the rest as JSON", () => {
    expect(detailPairs({ role: "staff", count: 3, ok: true, none: null, ids: ["a", "b"] })).toEqual([
      "role: staff",
      "count: 3",
      "ok: true",
      "none: null",
      'ids: ["a","b"]',
    ]);
    expect(detailPairs(null)).toEqual([]);
  });

  it("is nothing for an event without one", () => {
    expect(detailView(null)).toBeNull();
    expect(detailView({})).toBeNull();
  });

  it("stays as it is when the pairs say everything", () => {
    const view = detailView({ from: "RUNNING", to: "COMPLETED" });
    expect(view).toMatchObject({ summary: "from: RUNNING · to: COMPLETED", expandable: false });
  });

  it("folds when the pairs are long, and keeps the whole JSON", () => {
    const detail = { reason: "x".repeat(200) };
    const view = detailView(detail)!;
    expect(view.expandable).toBe(true);
    expect(view.summary.length).toBeLessThanOrEqual(90);
    expect(view.summary.endsWith("…")).toBe(true);
    expect(JSON.parse(view.json)).toEqual(detail);
  });

  it("can be opened when a value is itself an object", () => {
    expect(detailView({ removed: { a: 1 } })?.expandable).toBe(true);
  });
});

describe("the audit log's address", () => {
  it("carries only the filters that are set, never a page", () => {
    expect(auditHref("/admin/audit", {})).toBe("/admin/audit");
    expect(auditHref("/admin/audit", { category: "job", actor_id: "u1", date_from: "2026-10-01", date_to: "2026-10-03" })).toBe(
      "/admin/audit?category=job&actor_id=u1&date_from=2026-10-01&date_to=2026-10-03"
    );
    expect(auditHref("/admin/audit", { actor_id: undefined, date_from: "" })).toBe("/admin/audit");
  });

  it("takes a day only when it is one", () => {
    expect(parseDay("2026-10-03")).toBe("2026-10-03");
    expect(parseDay("")).toBeUndefined();
    expect(parseDay(undefined)).toBeUndefined();
    expect(parseDay("10/03/2026")).toBeUndefined();
    expect(parseDay("2026-13-45")).toBeUndefined();
  });
});
