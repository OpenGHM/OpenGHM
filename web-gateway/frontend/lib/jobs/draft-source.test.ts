import { describe, expect, it } from "vitest";
import { draftSource } from "@/lib/jobs/draft-source";

describe("draftSource", () => {
  it("is the base snapshot, linking to its repository page", () => {
    expect(draftSource({ dataset_id: "ds-1", dataset_title: "Dataset one" })).toEqual({
      kind: "snapshot",
      id: "ds-1",
      title: "Dataset one",
      fullTitle: "Dataset one",
      href: "/repository/ds-1",
    });
  });

  it("shows the short name, and keeps the full title for the tooltip", () => {
    expect(
      draftSource({ dataset_id: "ds-1", dataset_title: "A very long paper title", dataset_short_title: "Short" })
    ).toMatchObject({ title: "Short", fullTitle: "A very long paper title" });
  });

  it("encodes the id in the href, as the catalogue does", () => {
    expect(draftSource({ dataset_id: "a b/c", dataset_title: "T" }).href).toBe("/repository/a%20b%2Fc");
  });
});
