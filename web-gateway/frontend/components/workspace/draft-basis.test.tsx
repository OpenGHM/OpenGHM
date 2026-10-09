import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DraftBasis, basisFullTitle, basisTitle } from "@/components/workspace/draft-basis";
import type { DraftContext } from "@/lib/workspace/draft-state";
import { fakeDataset } from "@/lib/workspace/fixtures";

afterEach(cleanup);

const FULL = "A very long paper title: [Wyoming] [2000-2009]";
const base = fakeDataset();
const found = (shortName?: string) =>
  ({ snapshotState: "found", dataset: { ...base, about: { ...base.about, name: FULL, shortName } } }) as unknown as DraftContext;
const gone = { snapshotState: "gone", dataset: null } as unknown as DraftContext;

describe("the title of what a draft is based on", () => {
  it("is the found snapshot's short name, with its full title for the tooltip", () => {
    expect(basisTitle(found("Wyoming 2000s"), "stale")).toBe("Wyoming 2000s");
    expect(basisFullTitle(found("Wyoming 2000s"), "stale")).toBe(FULL);
  });

  it("is the full title as before when the snapshot has no short name", () => {
    expect(basisTitle(found(), "stale")).toBe(FULL);
    expect(basisFullTitle(found(), "stale")).toBe(FULL);
  });

  it("is what the draft was made with when the snapshot is gone, short name first", () => {
    expect(basisTitle(gone, "Made with", "Made short")).toBe("Made short");
    expect(basisTitle(gone, "Made with", null)).toBe("Made with");
    expect(basisTitle(gone, "Made with")).toBe("Made with");
    expect(basisFullTitle(gone, "Made with")).toBe("Made with");
  });

  it("shows on the card as the short name, the whole title on hover", () => {
    render(<DraftBasis ctx={found("Wyoming 2000s")} datasetId="d1" fallbackTitle="stale" />);
    const title = screen.getByText("Wyoming 2000s");
    expect(title.getAttribute("title")).toBe(FULL);
  });
});
