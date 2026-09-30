import { describe, expect, it } from "vitest";
import { displayStatus } from "@/lib/jobs/display-status";

describe("displayStatus", () => {
  it("shows the stored status when no cancel was asked for", () => {
    expect(displayStatus({ status: "RUNNING" })).toBe("RUNNING");
    expect(displayStatus({ status: "RUNNING", cancel_requested_at: null })).toBe("RUNNING");
  });

  it.each(["PENDING", "SUBMITTED", "RUNNING", "COMPLETING"] as const)(
    "shows Cancelling for a %s job with a cancel request",
    (status) => {
      expect(displayStatus({ status, cancel_requested_at: "2026-09-30T10:00:00Z" })).toBe(
        "CANCELLING"
      );
    }
  );

  it.each(["COMPLETED", "FAILED", "CANCELLED"] as const)(
    "lets a terminal %s status win over an old cancel request",
    (status) => {
      expect(displayStatus({ status, cancel_requested_at: "2026-09-30T10:00:00Z" })).toBe(status);
    }
  );
});
