import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { DraftStepHeading } from "@/components/workspace/draft-step-heading";
import { WizardLayout } from "@/components/workspace/wizard-layout";

afterEach(cleanup);

describe("WizardLayout", () => {
  it("puts the step beside a Help aside that is a column from xl and a sticky one under the header", () => {
    render(
      <WizardLayout step="review" facts={{}}>
        <p>the step</p>
      </WizardLayout>
    );
    const aside = screen.getByRole("complementary", { name: "Help", hidden: true });
    // Not there below xl (a Help button takes its place), a column from xl.
    for (const name of ["hidden", "xl:block", "xl:sticky", "xl:top-24", "xl:overflow-y-auto", "xl:self-start"]) {
      expect(aside.classList.contains(name)).toBe(true);
    }
    expect(within(aside).getByRole("heading", { level: 3, name: "Review and submit", hidden: true })).toBeTruthy();
    expect(screen.getByText("the step").closest("div")?.parentElement?.classList.contains("xl:grid")).toBe(true);
  });

  it("gives a step's heading a Help button for the sizes without the aside", () => {
    render(
      <WizardLayout step="run" facts={{}}>
        <DraftStepHeading step="run">What it is for.</DraftStepHeading>
      </WizardLayout>
    );
    expect(screen.getByRole("heading", { level: 2, name: "Run settings" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Help" }).classList.contains("xl:hidden")).toBe(true);
  });

  it("leaves a step heading alone when there is no layout around it", () => {
    render(<DraftStepHeading step="run">What it is for.</DraftStepHeading>);
    expect(screen.queryByRole("button", { name: "Help" })).toBeNull();
  });
});
