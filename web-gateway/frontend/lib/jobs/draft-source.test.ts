import { describe, expect, it } from "vitest";
import { draftSource } from "@/lib/jobs/draft-source";

describe("draftSource", () => {
  it("is the base snapshot, linking to its repository page", () => {
    expect(draftSource({ dataset_id: "ds-1", dataset_title: "Dataset one" })).toEqual({
      kind: "snapshot",
      id: "ds-1",
      title: "Dataset one",
      href: "/repository/ds-1",
    });
  });

  it("encodes the id in the href, as the catalogue does", () => {
    expect(draftSource({ dataset_id: "a b/c", dataset_title: "T" }).href).toBe("/repository/a%20b%2Fc");
  });
});
