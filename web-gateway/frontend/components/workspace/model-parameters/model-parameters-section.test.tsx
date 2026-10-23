import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ModelParametersSection } from "@/components/workspace/model-parameters/model-parameters-section";
import type { CustomParams, ModelParameters, ParamGroup } from "@/lib/workspace/model-parameters";
import type { ModelParametersState } from "@/lib/workspace/use-model-parameters";
import { fakeModelParameters, fakeParamField } from "@/lib/workspace/fixtures";

afterEach(cleanup);

const READY: ModelParametersState = { status: "ready", tree: fakeModelParameters() };

/** The section as the run step holds it: `custom_params` is state, and every
 *  change is also reported to `onChange`, so a test can read both. */
function section({
  state = READY,
  initial = null,
  errors,
  error,
  onRetry,
}: {
  state?: ModelParametersState;
  initial?: CustomParams | null;
  errors?: Record<string, string>;
  error?: string | null;
  onRetry?: () => void;
} = {}) {
  const onChange = vi.fn();
  function Harness() {
    const [custom, setCustom] = useState<CustomParams | null>(initial);
    return (
      <ModelParametersSection
        state={state}
        custom={custom}
        errors={errors}
        error={error}
        onRetry={onRetry}
        onChange={(next) => {
          onChange(next);
          setCustom(next);
        }}
      />
    );
  }
  return { onChange, ...render(<Harness />) };
}

const open = () => fireEvent.click(screen.getByRole("button", { name: "Edit model parameters" }));
const openDisclosure = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
/** The tree's group of that name, opened unless a change in it already opened it. */
const openGroup = (name: string | RegExp) => {
  const button = screen.getByRole("button", { name });
  if (button.getAttribute("aria-expanded") === "false") fireEvent.click(button);
};
const PARAMS = /^WBM parameters/;
const last = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.at(-1)![0];

describe("the Model parameters section: closed", () => {
  it("is a card with a heading, the code version and no changes, and none of the fields", () => {
    section();
    expect(screen.getByRole("heading", { level: 3, name: "Model parameters" })).toBeTruthy();
    expect(screen.getByText("WBM 22.1.1 · No parameters changed")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit model parameters" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByLabelText("Soil moisture drying coefficient")).toBeNull();
  });

  it("counts the parameters the draft changes", () => {
    section({ initial: { "wbmParam.alpha": "7" } });
    expect(screen.getByText("WBM 22.1.1 · 1 parameter changed")).toBeTruthy();
    cleanup();
    section({ initial: { "wbmParam.alpha": "7", Glaciers: "" } });
    expect(screen.getByText("WBM 22.1.1 · 2 parameters changed")).toBeTruthy();
  });

  it("marks the button an Edit link on Review can press to reach the controls", () => {
    section();
    expect(screen.getByRole("button", { name: "Edit model parameters" }).getAttribute("data-draft-reveals")).toBe(
      "custom"
    );
  });
});

describe("the Model parameters section: groups and tiers", () => {
  it("opens to the groups, closed, and a group opens to its basic fields", () => {
    section();
    open();
    expect(screen.getByRole("button", { name: "Run" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByLabelText("Run description")).toBeNull();
    openDisclosure("Run");
    expect(screen.getByLabelText("Run description")).toBeTruthy();
    expect(screen.getByLabelText("Spin-up loops")).toBeTruthy();
    openDisclosure("Run");
    expect(screen.queryByLabelText("Run description")).toBeNull();
  });

  it("puts the advanced fields of a group behind an Advanced disclosure of their own", () => {
    section();
    open();
    openGroup(PARAMS);
    expect(screen.getByLabelText("Soil moisture drying coefficient")).toBeTruthy();
    expect(screen.queryByLabelText("Runoff storage limit")).toBeNull();
    expect(screen.queryByLabelText("HBV direct infiltration recharge factor")).toBeNull();
    openDisclosure("Advanced");
    expect(screen.getByLabelText("Runoff storage limit")).toBeTruthy();
    expect(screen.getByLabelText("HBV direct infiltration recharge factor")).toBeTruthy();
  });

  it("draws no Advanced disclosure inside an advanced group, at any depth", () => {
    const soil: ParamGroup = {
      kind: "group",
      key: "soil_runoff",
      label: "Soil runoff",
      doc: null,
      tier: "advanced",
      children: [fakeParamField("wbmParam.alpha", { key: "alpha", label: "Soil moisture drying coefficient", tier: "advanced", current: "5" })],
    };
    const tree: ModelParameters = {
      code_version: "22.1.1",
      groups: [
        {
          kind: "group",
          key: "hydrology_params",
          label: "WBM parameters (wbmParam)",
          doc: null,
          tier: "advanced",
          children: [soil],
        },
      ],
    };
    section({ state: { status: "ready", tree } });
    open();
    // The one Advanced disclosure is the section's own.
    expect(screen.getAllByRole("button", { name: "Advanced" })).toHaveLength(1);
    openDisclosure("Advanced");
    openGroup(PARAMS);
    expect(screen.queryByRole("button", { name: "Advanced" })).toBeTruthy();
    openGroup("Soil runoff");
    expect(screen.getAllByRole("button", { name: "Advanced" })).toHaveLength(1);
    expect(screen.getByLabelText("Soil moisture drying coefficient")).toBeTruthy();
  });

  it("gives a basic group with an advanced child its own Advanced disclosure", () => {
    const tree: ModelParameters = {
      code_version: "22.1.1",
      groups: [
        {
          kind: "group",
          key: "basic_group",
          label: "Basic group",
          doc: null,
          tier: "basic",
          children: [
            fakeParamField("A.one", { key: "one", label: "Plain one" }),
            fakeParamField("A.two", { key: "two", label: "Deep two", tier: "advanced" }),
          ],
        },
      ],
    };
    section({ state: { status: "ready", tree } });
    open();
    openGroup("Basic group");
    expect(screen.getByLabelText("Plain one")).toBeTruthy();
    expect(screen.queryByLabelText("Deep two")).toBeNull();
    openDisclosure("Advanced");
    expect(screen.getByLabelText("Deep two")).toBeTruthy();
  });

  it("shows a read-only field's value without a control", () => {
    section();
    open();
    openGroup(PARAMS);
    expect(screen.queryByLabelText("Runoff storage release coefficient")).toBeNull();
    expect(screen.getByText("Runoff storage release coefficient")).toBeTruthy();
  });

  it("opens the groups and the Advanced disclosure that already hold a change", () => {
    section({ initial: { "wbmParam.maxRffStorage": "500" } });
    open();
    expect((screen.getByLabelText("Runoff storage limit") as HTMLInputElement).value).toBe("500");
    expect(screen.getByRole("button", { name: /^WBM parameters \(wbmParam\)1 changed$/ })).toBeTruthy();
    expect(screen.queryByLabelText("Run description")).toBeNull();
  });
});

describe("the Model parameters section: changing and resetting", () => {
  const alpha = () => screen.getByLabelText("Soil moisture drying coefficient") as HTMLInputElement;
  const reach = () => {
    open();
    openGroup(PARAMS);
  };

  it("writes custom_params[path] as the text typed, and counts it", () => {
    const { onChange } = section();
    reach();
    fireEvent.change(alpha(), { target: { value: "7.5" } });
    expect(last(onChange)).toEqual({ "wbmParam.alpha": "7.5" });
    expect(alpha().value).toBe("7.5");
    expect(screen.getByText("WBM 22.1.1 · 1 parameter changed")).toBeTruthy();
    expect(screen.getByText("Changed")).toBeTruthy();
  });

  it("keeps the other changes, and a change to an enum, a flag, a string and a date writes its text", () => {
    const { onChange } = section({ initial: { "wbmParam.alpha": "7" } });
    open();
    openGroup(PARAMS);
    fireEvent.change(screen.getByLabelText("Infiltration method"), { target: { value: "HBV" } });
    fireEvent.click(screen.getByRole("switch", { name: "Endorheic directions" }));
    expect(last(onChange)).toEqual({
      "wbmParam.alpha": "7",
      "wbmParam.Infiltration": "HBV",
      "wbmParam.endorheicDir": "1",
    });
    openGroup("Run");
    fireEvent.change(screen.getByLabelText("Run description"), { target: { value: "New" } });
    fireEvent.change(screen.getByLabelText("Spin-up start"), { target: { value: "2002-01-01" } });
    fireEvent.change(screen.getByLabelText("Spin-up loops"), { target: { value: "2" } });
    expect(last(onChange)).toMatchObject({ Comment: "New", "Spinup.Start": "2002-01-01", "Spinup.Loops": "2" });
  });

  it("does not keep a value that is the snapshot's own", () => {
    const { onChange } = section({ initial: { "wbmParam.alpha": "7" } });
    open();
    expect(alpha().value).toBe("7");
    fireEvent.change(alpha(), { target: { value: "5" } });
    expect(last(onChange)).toBeNull();
    expect(screen.getByText("WBM 22.1.1 · No parameters changed")).toBeTruthy();
  });

  it("resets a field: the key goes, and the snapshot's value is back", () => {
    const { onChange } = section({ initial: { "wbmParam.alpha": "7", "wbmParam.Infiltration": "HBV" } });
    open();
    fireEvent.click(screen.getByRole("button", { name: "Reset Soil moisture drying coefficient" }));
    expect(last(onChange)).toEqual({ "wbmParam.Infiltration": "HBV" });
    expect(alpha().value).toBe("5");
    expect(screen.queryByRole("button", { name: "Reset Soil moisture drying coefficient" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reset Infiltration method" }));
    expect(last(onChange)).toBeNull();
  });
});

describe("the Model parameters section: modules", () => {
  const card = () => document.querySelector('[data-param-path="Glaciers"]') as HTMLElement;
  const reach = () => {
    open();
    openGroup(PARAMS);
  };

  it("is a card that says the module is on, with a Switch off", () => {
    section();
    reach();
    expect(within(card()).getByRole("heading", { name: "Runoff from Glaciated Areas" })).toBeTruthy();
    expect(within(card()).getByText("On")).toBeTruthy();
    expect(within(card()).getByText("Glaciers")).toBeTruthy();
    expect(within(card()).getByRole("button", { name: "Switch off Runoff from Glaciated Areas" })).toBeTruthy();
  });

  it("switches off with an empty value on the module's own key, says so, and resets", () => {
    const { onChange } = section({ initial: { "Glaciers.glRatio": "2" } });
    reach();
    fireEvent.click(within(card()).getByRole("button", { name: "Switch off Runoff from Glaciated Areas" }));
    // What its parameters were set to goes with it.
    expect(last(onChange)).toEqual({ Glaciers: "" });
    expect(within(card()).getByText("Switched off")).toBeTruthy();
    expect(within(card()).queryByRole("button", { name: /Switch off/ })).toBeNull();
    expect(screen.getByText("WBM 22.1.1 · 1 parameter changed")).toBeTruthy();
    fireEvent.click(within(card()).getByRole("button", { name: "Reset Runoff from Glaciated Areas" }));
    expect(last(onChange)).toBeNull();
    expect(within(card()).getByText("On")).toBeTruthy();
  });

  it("shows the module's own settings, while it is on, behind a Settings disclosure", () => {
    section();
    reach();
    expect(within(card()).queryByText("Glacier melt ratio")).toBeNull();
    fireEvent.click(within(card()).getByRole("button", { name: "Settings" }));
    expect(within(card()).getByLabelText("Glacier melt ratio")).toBeTruthy();
    fireEvent.change(within(card()).getByLabelText("Glacier melt ratio"), { target: { value: "2" } });
    fireEvent.click(within(card()).getByRole("button", { name: /^Switch off/ }));
    expect(within(card()).queryByText("Glacier melt ratio")).toBeNull();
  });

  it("offers no Switch off when the tree does not allow it, nor for a module the snapshot has off", () => {
    const tree = fakeModelParameters();
    const mod = tree.groups[1].kind === "group" ? tree.groups[1].children.find((n) => n.kind === "module") : null;
    if (mod?.kind !== "module") throw new Error("fixture has no module");
    mod.switch_off = false;
    section({ state: { status: "ready", tree } });
    reach();
    expect(within(card()).queryByRole("button", { name: /Switch off/ })).toBeNull();
    expect(within(card()).getByText("On")).toBeTruthy();
    cleanup();

    mod.switch_off = true;
    mod.state = "off";
    section({ state: { status: "ready", tree } });
    reach();
    expect(within(card()).getByText("Off in this snapshot")).toBeTruthy();
    expect(within(card()).queryByRole("button")).toBeNull();
  });
});

describe("the Model parameters section: what the backend refused", () => {
  it("stays open, shows each message at its field, and opens the group and disclosures that hold it", () => {
    section({
      initial: { "wbmParam.maxRffStorage": "-5", "wbmParam.alpha": "abc" },
      errors: { "wbmParam.maxRffStorage": "Must be at least 0.", "wbmParam.alpha": "Enter a number." },
      error: "Some model parameters are not valid.",
    });
    // No click was needed.
    expect(screen.queryByRole("button", { name: "Edit model parameters" })).toBeNull();
    expect(screen.getByText("Some model parameters are not valid.")).toBeTruthy();
    const alpha = screen.getByLabelText("Soil moisture drying coefficient");
    expect(alpha.getAttribute("aria-invalid")).toBe("true");
    expect(alpha.getAttribute("aria-describedby")).toContain(screen.getByText("Enter a number.").id);
    expect(screen.getByLabelText("Runoff storage limit").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Must be at least 0.")).toBeTruthy();
  });

  it("shows the message of a module's key at the module", () => {
    section({ initial: { Glaciers: "" }, errors: { Glaciers: "This module cannot be switched off." } });
    expect(screen.getByText("This module cannot be switched off.")).toBeTruthy();
  });

  it("lists a message for a key the tree has no field for, with the key and a way to remove it", () => {
    const { onChange } = section({
      initial: { "Made.up": "1" },
      errors: { "Made.up": "Unknown parameter." },
    });
    expect(screen.getByText("Unknown parameter.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove Made.up" }));
    expect(last(onChange)).toBeNull();
  });
});

describe("the Model parameters section: before and without the tree", () => {
  it("says it is loading, and shows a status when opened", () => {
    section({ state: { status: "loading" } });
    expect(screen.getByText("Loading the parameters…")).toBeTruthy();
    open();
    expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");
  });

  it("says the parameters are not available for a snapshot whose init could not be read", () => {
    section({ state: { status: "unavailable" } });
    expect(screen.getByText("Not available for this snapshot")).toBeTruthy();
    open();
    expect(screen.getByText(/init could not be read/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("says what failed, and tries again", () => {
    const onRetry = vi.fn();
    section({ state: { status: "error", message: "The server hit a problem." }, onRetry });
    expect(screen.getByText("Could not be loaded")).toBeTruthy();
    open();
    expect(screen.getByText("The server hit a problem.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("still lists what the draft changes, so it can be removed", () => {
    const { onChange } = section({ state: { status: "unavailable" }, initial: { "wbmParam.alpha": "7", Glaciers: "" } });
    expect(screen.getByText("Not available for this snapshot · 2 parameters changed")).toBeTruthy();
    open();
    expect(screen.getByText("wbmParam.alpha = 7")).toBeTruthy();
    expect(screen.getByText("Glaciers = (switched off)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove wbmParam.alpha" }));
    expect(last(onChange)).toEqual({ Glaciers: "" });
  });

  it("lists a change the tree has no field for, after the tree", () => {
    section({ initial: { "Spinup.Save_Vars": "1" } });
    open();
    expect(screen.getByText("Spinup.Save_Vars = 1")).toBeTruthy();
    expect(screen.getByText(/no field for/)).toBeTruthy();
  });
});
