import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import { draftField, focusDraftField, revealsDraftField } from "@/components/workspace/draft-field";

afterEach(cleanup);

/** A part that is closed until its button is pressed, as a `DraftCollapsible` is. */
function Part() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <h2 id="draft-step-run-heading" tabIndex={-1}>
        Run settings
      </h2>
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} {...revealsDraftField("cores", "walltime")}>
        Change
      </button>
      {open && (
        <>
          <input aria-label="Cores" {...draftField("cores")} />
          <input aria-label="Walltime" {...draftField("walltime")} />
        </>
      )}
    </div>
  );
}

describe("focusDraftField", () => {
  it("focuses the control marked for the field", () => {
    render(
      <>
        <h2 id="draft-step-run-heading" tabIndex={-1}>
          Run settings
        </h2>
        <input aria-label="Start" {...draftField("start")} />
      </>
    );
    focusDraftField("start", "run");
    expect(document.activeElement).toBe(screen.getByLabelText("Start"));
  });

  it("presses the button that reveals a control which is not on screen, then focuses it", async () => {
    render(<Part />);
    expect(screen.queryByLabelText("Walltime")).toBeNull();
    await act(async () => {
      focusDraftField("walltime", "run");
      await Promise.resolve();
    });
    expect(document.activeElement).toBe(screen.getByLabelText("Walltime"));
    expect(screen.getByRole("button", { name: "Change" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("does not close a part that is already open", async () => {
    render(<Part />);
    await act(async () => {
      focusDraftField("cores", "run");
      await Promise.resolve();
    });
    await act(async () => {
      focusDraftField("walltime", "run");
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: "Change" }).getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(screen.getByLabelText("Walltime"));
  });

  it("falls back to the step's heading when nothing renders the field", () => {
    render(<Part />);
    focusDraftField("spatial", "run");
    expect(document.activeElement?.id).toBe("draft-step-run-heading");
  });
});
