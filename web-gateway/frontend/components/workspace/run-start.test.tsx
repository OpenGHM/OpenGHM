import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/lib/jobs/actions", () => ({
  deriveSimulation: vi.fn(),
  submitSimulation: vi.fn(),
  updateSimulation: vi.fn(),
}));
vi.mock("@/lib/repository/actions", () => ({
  fetchModelInputById: vi.fn(() => new Promise(() => {})),
  fetchModelInputs: vi.fn(() => new Promise(() => {})),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/workspace/new/configure",
}));

import { NewSimulationWizard } from "@/components/workspace/new-simulation-wizard";
import { fakeDataset } from "@/lib/workspace/fixtures";
import type { Dataset } from "@/lib/repository/types";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(cleanup);

// fakeDataset covers 2001-01-01 .. 2001-12-31.
const yearly = fakeDataset({ runStartAlignment: "year" });

function startField() {
  return screen.getByLabelText("Start") as HTMLInputElement;
}
function setStart(value: string) {
  fireEvent.change(startField(), { target: { value } });
}
const nextButton = () => screen.getByRole("button", { name: /Next/ }) as HTMLButtonElement;

function wizardAtParameters(snapshot: Dataset) {
  render(<NewSimulationWizard snapshot={snapshot} submitBlockedReason={null} />);
  fireEvent.click(nextButton()); // model input -> parameters
}

describe("the wizard's parameters step", () => {
  it("states the rule next to the Start date", () => {
    wizardAtParameters(yearly);
    expect(
      screen.getByText("This model snapshot's model writes one file per year, so a run must start on January 1.")
    ).toBeTruthy();
    expect(startField().getAttribute("aria-invalid")).toBeNull();
    expect(nextButton().disabled).toBe(false);
  });

  it("flags a start the rule forbids, keeps Next off with the reason, and offers the fix", () => {
    wizardAtParameters(yearly);
    setStart("2001-03-01");

    expect(startField().getAttribute("aria-invalid")).toBe("true");
    const note = document.getElementById(startField().getAttribute("aria-describedby") ?? "");
    expect(note?.textContent).toContain("a run must start on January 1");
    expect(note?.getAttribute("aria-live")).toBe("polite");

    expect(nextButton().disabled).toBe(true);
    expect(nextButton().title).toBe("The start date doesn't suit this model. Change it to continue.");
    expect(
      screen.getByText("The start date doesn't suit this model. Change it to continue.")
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Start on 2001-01-01 instead" }));
    expect(startField().value).toBe("2001-01-01");
    expect(startField().getAttribute("aria-invalid")).toBeNull();
    expect(nextButton().disabled).toBe(false);
  });

  it("offers no fix when no allowed start is inside the coverage", () => {
    wizardAtParameters(fakeDataset({ runStartAlignment: "year", simulation: { ...yearly.simulation, temporalCoverage: { start: "2001-03-01", end: "2001-12-31" } } }));
    setStart("2001-05-01");
    expect(nextButton().disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /instead/ })).toBeNull();
  });

  it("says it could not check, and blocks nothing", () => {
    wizardAtParameters(fakeDataset({ runStartAlignment: null }));
    setStart("2001-03-01");
    expect(screen.getByText(/couldn't check where this model's runs may start/)).toBeTruthy();
    expect(startField().getAttribute("aria-invalid")).toBeNull();
    expect(nextButton().disabled).toBe(false);
  });

  it("says nothing about a model with no rule", () => {
    wizardAtParameters(fakeDataset({ runStartAlignment: "none" }));
    setStart("2001-03-01");
    expect(screen.queryByText(/couldn't check/)).toBeNull();
    expect(screen.queryByText(/one file per/)).toBeNull();
    expect(nextButton().disabled).toBe(false);
  });
});
