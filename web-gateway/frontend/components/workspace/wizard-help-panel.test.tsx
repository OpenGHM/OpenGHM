import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { DraftRunStep } from "@/components/workspace/draft-run-step";
import { DraftSection } from "@/components/workspace/draft-section";
import { HOVER_LINGER_MS, WizardHelpProvider, useWizardHelp } from "@/components/workspace/wizard-help-context";
import { WizardHelpButton, WizardHelpPanel } from "@/components/workspace/wizard-help-panel";
import type { JobParameters } from "@/lib/jobs/types";
import type { DraftContext } from "@/lib/workspace/draft-state";
import { fakeDataset } from "@/lib/workspace/fixtures";
import type { HelpStep } from "@/lib/workspace/wizard-help";

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

/** The heading the panel shows now. */
const shown = () => within(screen.getByRole("complementary", { name: "Help" })).getByRole("heading", { level: 3 }).textContent;

function Sections({ step = "run", facts = {} }: { step?: HelpStep; facts?: { climatologyAvailable?: boolean } }) {
  return (
    <WizardHelpProvider step={step} facts={facts}>
      <aside aria-label="Help">
        <WizardHelpPanel />
      </aside>
      <DraftSection title="Run period" help="period">
        <input aria-label="Start" />
      </DraftSection>
      <DraftSection title="Compute" help="compute">
        <input aria-label="Cores" />
      </DraftSection>
      <DraftSection title="Plain">
        <input aria-label="Elsewhere" />
      </DraftSection>
    </WizardHelpProvider>
  );
}

describe("WizardHelpPanel", () => {
  it("opens on the step's overview, in a polite live region", () => {
    render(<Sections />);
    expect(shown()).toBe("Run settings");
    const live = document.querySelector("[aria-live]");
    expect(live?.getAttribute("aria-live")).toBe("polite");
    expect(live?.contains(within(screen.getByRole("complementary", { name: "Help" })).getByRole("heading", { level: 3 }))).toBe(
      true
    );
  });

  it("shows the Start and Review overviews", () => {
    const { rerender } = render(<Sections step="start" />);
    expect(shown()).toBe("Choosing a model snapshot");
    rerender(<Sections step="review" />);
    expect(shown()).toBe("Review and submit");
  });

  it("switches to a section's help on focus inside it, and keeps it when focus leaves", () => {
    render(<Sections />);
    fireEvent.focus(screen.getByLabelText("Start"));
    expect(shown()).toBe("Run period");
    fireEvent.focus(screen.getByLabelText("Cores"));
    expect(shown()).toBe("Compute");
    // A control in a section with no help of its own changes nothing.
    fireEvent.focus(screen.getByLabelText("Elsewhere"));
    expect(shown()).toBe("Compute");
    fireEvent.blur(screen.getByLabelText("Cores"));
    expect(shown()).toBe("Compute");
  });

  it("goes back to the overview on request", () => {
    render(<Sections />);
    expect(screen.queryByRole("button", { name: /back to/i })).toBeNull();
    fireEvent.focus(screen.getByLabelText("Start"));
    fireEvent.click(screen.getByRole("button", { name: "Back to run settings" }));
    expect(shown()).toBe("Run settings");
  });

  it("never takes focus", () => {
    render(<Sections />);
    const input = screen.getByLabelText("Start");
    act(() => input.focus());
    expect(shown()).toBe("Run period");
    expect(document.activeElement).toBe(input);
  });

  it("follows the pointer, which wins while it is over a section, and lingers briefly after", () => {
    vi.useFakeTimers();
    render(<Sections />);
    const section = screen.getByRole("heading", { name: "Compute" }).closest("section")!;
    fireEvent.pointerEnter(section);
    expect(shown()).toBe("Compute");
    // Focus is elsewhere: the pointer wins.
    fireEvent.focus(screen.getByLabelText("Start"));
    expect(shown()).toBe("Compute");
    fireEvent.pointerLeave(section);
    expect(shown()).toBe("Compute");
    act(() => {
      vi.advanceTimersByTime(HOVER_LINGER_MS + 1);
    });
    expect(shown()).toBe("Run period");
  });

  it("keeps what it shows while the pointer is on the panel", () => {
    vi.useFakeTimers();
    render(<Sections />);
    const section = screen.getByRole("heading", { name: "Compute" }).closest("section")!;
    const panel = screen.getByRole("complementary", { name: "Help" }).firstElementChild!;
    fireEvent.pointerEnter(section);
    fireEvent.pointerLeave(section);
    fireEvent.pointerEnter(panel);
    act(() => {
      vi.advanceTimersByTime(HOVER_LINGER_MS * 3);
    });
    expect(shown()).toBe("Compute");
    fireEvent.pointerLeave(panel);
    expect(shown()).toBe("Run settings");
  });

  it("ignores a touch, which is a tap that focuses a control", () => {
    render(<Sections />);
    const section = screen.getByRole("heading", { name: "Compute" }).closest("section")!;
    fireEvent.pointerEnter(section, { pointerType: "touch" });
    expect(shown()).toBe("Run settings");
  });

  it("starts over when the step changes", () => {
    const { rerender } = render(<Sections />);
    fireEvent.focus(screen.getByLabelText("Cores"));
    rerender(<Sections step="review" />);
    expect(shown()).toBe("Review and submit");
    rerender(<Sections step="run" />);
    expect(shown()).toBe("Run settings");
  });

  it("does not count a focus made quietly", () => {
    function Quiet() {
      const help = useWizardHelp()!;
      return (
        <button type="button" onClick={() => help.quietly(() => screen.getByLabelText("Start").focus())}>
          go
        </button>
      );
    }
    render(
      <WizardHelpProvider step="run" facts={{}}>
        <aside aria-label="Help">
          <WizardHelpPanel />
        </aside>
        <Quiet />
        <DraftSection title="Run period" help="period">
          <input aria-label="Start" />
        </DraftSection>
      </WizardHelpProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "go" }));
    expect(document.activeElement).toBe(screen.getByLabelText("Start"));
    expect(shown()).toBe("Run settings");
  });

  it("tells the truth about climatology from what the snapshot offers", () => {
    function Output({ available }: { available: boolean }) {
      return (
        <WizardHelpProvider step="run" facts={{ climatologyAvailable: available }}>
          <aside aria-label="Help">
            <WizardHelpPanel />
          </aside>
          <DraftSection title="Output" help="output">
            <input aria-label="Daily" />
          </DraftSection>
        </WizardHelpProvider>
      );
    }
    const view = render(<Output available={false} />);
    fireEvent.focus(screen.getByLabelText("Daily"));
    expect(screen.getByText(/Also climatology is not available yet/)).toBeTruthy();
    view.rerender(<Output available />);
    expect(screen.queryByText(/not available yet/)).toBeNull();
    expect(screen.getByText(/three files per variable/)).toBeTruthy();
  });

  it("draws nothing, and breaks nothing, outside a provider", () => {
    const { container } = render(
      <>
        <WizardHelpPanel />
        <WizardHelpButton />
        <DraftSection title="Run period" help="period">
          <input aria-label="Start" />
        </DraftSection>
      </>
    );
    fireEvent.focus(screen.getByLabelText("Start"));
    expect(screen.queryByRole("heading", { level: 3, name: "Run settings" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Help" })).toBeNull();
    expect(container.querySelector("section")).not.toBeNull();
  });
});

describe("WizardHelpButton", () => {
  it("is a Help button that is gone from xl up, and opens the same help in a sheet", () => {
    render(
      <WizardHelpProvider step="review" facts={{}}>
        <WizardHelpButton />
      </WizardHelpProvider>
    );
    const button = screen.getByRole("button", { name: "Help" });
    expect(button.classList.contains("xl:hidden")).toBe(true);
    expect(button.getAttribute("aria-haspopup")).toBe("dialog");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(button);
    const sheet = screen.getByRole("dialog", { name: "Help" });
    expect(within(sheet).getByRole("heading", { level: 3, name: "Review and submit" })).toBeTruthy();
    expect(sheet.querySelector("[aria-live=polite]")).not.toBeNull();
  });

  it("shows the section the person was in", () => {
    render(
      <WizardHelpProvider step="run" facts={{}}>
        <WizardHelpButton />
        <DraftSection title="Compute" help="compute">
          <input aria-label="Cores" />
        </DraftSection>
      </WizardHelpProvider>
    );
    fireEvent.focus(screen.getByLabelText("Cores"));
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    expect(within(screen.getByRole("dialog")).getByRole("heading", { level: 3, name: "Compute" })).toBeTruthy();
  });
});

describe("the sections of Run settings", () => {
  const dataset = fakeDataset({
    runStartAlignment: "year",
    climatologyAvailable: false,
    simulation: {
      ...fakeDataset().simulation,
      outputVariables: [{ name: "discharge", fullName: "Discharge", unit: "m3/s" }],
      recommendedCompute: { cores: 16, walltime: "15:00" },
    },
  });
  const ctx: DraftContext = { dataset, snapshotState: "found" };
  const parameters: JobParameters = {
    temporal_range_start: "2001-01-01",
    temporal_range_end: "2001-12-31",
    spatial_domain: null,
    variables: ["discharge"],
    custom_params: null,
  };

  function step(autoFocusName = false) {
    return render(
      <WizardHelpProvider step="run" facts={{ climatologyAvailable: false }}>
        <aside aria-label="Help">
          <WizardHelpPanel />
        </aside>
        <DraftRunStep
          datasetId="snap-1"
          datasetTitle="Kept title"
          ctx={ctx}
          parameters={parameters}
          slurm={{ cores: null, walltime: null }}
          recommended={dataset.simulation.recommendedCompute}
          modelInputId={null}
          resolvedModelInput={undefined}
          name=""
          description=""
          autoFocusName={autoFocusName}
          onNameChange={vi.fn()}
          onDescriptionChange={vi.fn()}
          serverErrors={{}}
          startRefusal={null}
          onParametersChange={vi.fn()}
          onSlurmChange={vi.fn()}
          onRevertModelInput={vi.fn()}
        />
      </WizardHelpProvider>
    );
  }

  it("each section's controls bring up that section's help", () => {
    step();
    expect(shown()).toBe("Run settings");

    fireEvent.focus(screen.getByLabelText("Name"));
    expect(shown()).toBe("Name and description");
    fireEvent.focus(screen.getByLabelText("Description", { exact: false }));
    expect(shown()).toBe("Name and description");

    fireEvent.focus(screen.getByLabelText("Start"));
    expect(shown()).toBe("Run period");
    fireEvent.focus(screen.getByLabelText("End"));
    expect(shown()).toBe("Run period");

    fireEvent.focus(screen.getByRole("button", { name: "Choose output variables" }));
    expect(shown()).toBe("Output variables");

    fireEvent.focus(screen.getByRole("radio", { name: /Daily, monthly and yearly/ }));
    expect(shown()).toBe("Output");
    expect(screen.getByText(/Also climatology is not available yet/)).toBeTruthy();

    fireEvent.focus(screen.getByRole("button", { name: "Change compute" }));
    expect(shown()).toBe("Compute");
  });

  it("opens on the overview even when the Name is focused as the step opens", () => {
    step(true);
    expect(document.activeElement).toBe(screen.getByLabelText("Name"));
    expect(shown()).toBe("Run settings");
  });
});
