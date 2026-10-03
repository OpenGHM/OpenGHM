import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// A simulation that starts from a model input: no job does yet, so the source is faked.
vi.mock("@/lib/jobs/simulation-source", () => ({
  simulationSource: () => ({ kind: "model-input", id: "mi-1", title: "Ancillary Data v1", href: "/repository/model-inputs/mi-1" }),
}));
vi.mock("@/lib/jobs/actions", () => ({ cancelJob: vi.fn(), deleteSimulation: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/workspace",
}));

import { SimulationTable } from "@/components/workspace/simulation-table";
import { fakeSimulation } from "@/lib/workspace/fixtures";

afterEach(cleanup);

describe("the simulation list for a source that is not a model snapshot", () => {
  it("says what the source is before its title, so a mixed list tells them apart", () => {
    render(<SimulationTable jobs={[fakeSimulation("COMPLETED")]} runNotes={{ "fake-completed": "Run 2001" }} />);
    expect(screen.getByText("Model Input ·")).toBeTruthy();
    expect(screen.getByText("Ancillary Data v1")).toBeTruthy();
    expect(screen.getByText(/Run 2001/)).toBeTruthy();
  });
});
