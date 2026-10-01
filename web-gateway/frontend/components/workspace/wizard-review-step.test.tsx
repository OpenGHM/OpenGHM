import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ModelInput } from "@/lib/repository/types";

vi.mock("@/lib/jobs/actions", () => ({
  deriveSimulation: vi.fn(),
  submitSimulation: vi.fn(),
  updateSimulation: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/workspace/new/configure",
}));

import { WizardReviewStep } from "@/components/workspace/wizard-review-step";
import { fakeDataset } from "@/lib/workspace/fixtures";
import {
  defaultParametersFor,
  defaultSlurmConfigFor,
  recommendedComputeFor,
  type ModelInputChoice,
} from "@/lib/workspace/wizard-types";

afterEach(cleanup);

const snapshot = fakeDataset();
const catalogueEntry = { id: "fake-model-input-id", about: { name: "Global 5 min network" } } as ModelInput;

function review(inherited: ModelInput | null | undefined, choice: ModelInputChoice = { mode: "inherit" }) {
  return render(
    <WizardReviewStep
      snapshot={snapshot}
      modelInputChoice={choice}
      inheritedModelInput={inherited}
      parameters={defaultParametersFor(snapshot)}
      slurmConfig={defaultSlurmConfigFor()}
      recommended={recommendedComputeFor(snapshot)}
      blockedReason={null}
    />
  );
}

describe("the review step's model input", () => {
  it("says the catalogue holds it when step 2 found it", () => {
    const { container } = review(catalogueEntry);
    expect(screen.getByText("Inherited: Global 5 min network")).toBeTruthy();
    expect(container.textContent).toContain("found in the catalogue");
    expect(container.textContent).not.toMatch(/inherited-missing|may turn out/);
  });

  it("says plainly that a model input the catalogue lacks changes nothing for the run", () => {
    const { container } = review(null);
    expect(container.textContent).toContain("The catalogue does not list it.");
    expect(container.textContent).toContain("The run fetches it by id, so this changes nothing about the run.");
    expect(container.textContent).not.toMatch(/inherited-missing|may turn out/);
  });

  it("does not claim either while step 2 is still looking", () => {
    const { container } = review(undefined);
    expect(container.textContent).toContain("Checking the catalogue…");
    expect(container.textContent).not.toContain("found in the catalogue");
    expect(container.textContent).not.toContain("does not list it");
  });

  it("names the chosen one when the user overrode it", () => {
    review(null, { mode: "chosen", modelInput: catalogueEntry });
    expect(screen.getByText("Chosen")).toBeTruthy();
    expect(screen.getByText("Global 5 min network")).toBeTruthy();
  });
});
