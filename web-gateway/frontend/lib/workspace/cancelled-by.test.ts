import { describe, expect, it } from "vitest";
import { cancelledBy } from "@/lib/workspace/cancelled-by";
import type { FailureCause } from "@/lib/jobs/types";

const failure = (cause: FailureCause) => ({ cause, phase: null, message: "", excerpt: null });

describe("cancelledBy", () => {
  it("says you, for the viewer's own cancel", () => {
    expect(
      cancelledBy(
        {
          failure: failure("cancelled_by_user"),
          cancel_requested_at: "2026-09-30T10:00:00Z",
          cancel_requested_by_email: "Me@Purdue.edu",
        },
        "me@purdue.edu"
      )
    ).toBe("You cancelled this run");
  });

  it("names someone else", () => {
    expect(
      cancelledBy(
        {
          failure: failure("cancelled_by_user"),
          cancel_requested_at: "2026-09-30T10:00:00Z",
          cancel_requested_by_email: "colleague@purdue.edu",
        },
        "me@purdue.edu"
      )
    ).toBe("Cancelled by colleague@purdue.edu");
  });

  it("says Anvil or an administrator for a cancel nobody here asked for", () => {
    expect(
      cancelledBy(
        { failure: failure("cancelled_by_system"), cancel_requested_at: null, cancel_requested_by_email: null },
        "me@purdue.edu"
      )
    ).toBe("Cancelled by Anvil or an administrator");
  });

  it("claims nothing about an old job with no record", () => {
    expect(
      cancelledBy({ failure: null, cancel_requested_at: null, cancel_requested_by_email: null }, "me@purdue.edu")
    ).toBe("Cancelled");
  });
});
