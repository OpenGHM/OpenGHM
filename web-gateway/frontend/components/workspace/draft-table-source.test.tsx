import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// A snapshot draft that starts from a model input: no job does yet, so the source is faked.
vi.mock("@/lib/jobs/draft-source", () => ({
  draftSource: () => ({ kind: "model-input", id: "mi-1", title: "Ancillary Data v1", href: "/repository/model-inputs/mi-1" }),
}));
vi.mock("@/lib/jobs/actions", () => ({ cancelJob: vi.fn(), deleteDraft: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/workspace",
}));

import { DraftTable } from "@/components/workspace/draft-table";
import { fakeDraft } from "@/lib/workspace/fixtures";

afterEach(cleanup);

describe("the snapshot draft list for a source that is not a model snapshot", () => {
  it("says what the source is before its title, so a mixed list tells them apart", () => {
    // A named draft: an unnamed one is named after its source and shows its run id here instead.
    const named = fakeDraft("COMPLETED");
    render(<DraftTable jobs={[{ ...named, about: { ...named.about, name: "Irrigation test" } as typeof named.about }]} />);
    expect(screen.getByText("Model Input ·")).toBeTruthy();
    expect(screen.getByText("Ancillary Data v1")).toBeTruthy();
  });
});
