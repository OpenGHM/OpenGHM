import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ModelParametersSection } from "@/components/workspace/model-parameters/model-parameters-section";
import type { CustomParams, ModelParameters, ParamGroup } from "@/lib/workspace/model-parameters";
import type { ModelParametersState } from "@/lib/workspace/use-model-parameters";
import { fakeModelParameters, fakeParamField, fakeSwitchOnTree } from "@/lib/workspace/fixtures";

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

describe("the Model parameters section: switching a module on", () => {
  const SWITCH_ON: ModelParametersState = { status: "ready", tree: fakeSwitchOnTree() };
  const MELT = "/wbm/data_init/glaciers/discharge_m.init";
  const AREA = "/wbm/data_init/glaciers/area_1km.init";
  const card = (path: string) => document.querySelector(`[data-param-path="${path}"]`) as HTMLElement;
  const reach = () => {
    open();
    openGroup(/^Modules/);
  };
  const choose = (label: string | RegExp, value: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } });

  it("offers Switch on for a module the snapshot has off and the backend says can be", () => {
    section({ state: SWITCH_ON });
    reach();
    expect(within(card("Glaciers")).getByText("Off in this snapshot")).toBeTruthy();
    expect(within(card("Glaciers")).getByRole("button", { name: "Switch on Runoff from Glaciated Areas" })).toBeTruthy();
    // none of its fields is shown until it is on
    expect(within(card("Glaciers")).queryByText("Glacier melt discharge")).toBeNull();
  });

  it("says why a module cannot be switched on, and offers nothing for it", () => {
    section({ state: SWITCH_ON });
    reach();
    const irrigation = card("Irrigation");
    expect(within(irrigation).getByText(/Can't be switched on here\. It needs a file, which cannot be chosen here yet/)).toBeTruthy();
    expect(within(irrigation).queryByRole("button")).toBeNull();
    expect(within(irrigation).queryByText("Return coefficient")).toBeNull();
  });

  it("switches on: the module's required datasets are chosen from the model input's, each by name", () => {
    const { onChange } = section({ state: SWITCH_ON });
    reach();
    fireEvent.click(within(card("Glaciers")).getByRole("button", { name: "Switch on Runoff from Glaciated Areas" }));
    // nothing is chosen yet, so there is nothing to keep: the module is open, not changed
    expect(last(onChange)).toBeNull();
    expect(within(card("Glaciers")).getByText("Switched on")).toBeTruthy();
    expect(within(card("Glaciers")).queryByRole("button", { name: /^Switch on/ })).toBeNull();
    const melt = screen.getByLabelText("Glacier melt discharge") as HTMLSelectElement;
    expect(melt.value).toBe("");
    expect(screen.getAllByText("Required", { selector: "span" })).toHaveLength(2);
    // the placeholder cannot be chosen again for a required field, and the field is offered the
    // dataset of its own unit and no other
    expect((within(melt).getByRole("option", { name: "Choose a dataset…" }) as HTMLOptionElement).disabled).toBe(true);
    expect(within(melt).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Choose a dataset…",
      "Glacier discharge, monthly · monthly · m3/sec",
    ]);
    expect(within(melt).queryByRole("group")).toBeNull();
    choose("Glacier melt discharge", MELT);
    expect(last(onChange)).toEqual({ "Glaciers.glMelt": MELT });
    choose("Glacier area fraction", AREA);
    expect(last(onChange)).toEqual({ "Glaciers.glMelt": MELT, "Glaciers.glArea": AREA });
    expect(screen.getByText("WBM 23.9.0 · 2 parameters changed")).toBeTruthy();
    // the pill says what is still to be chosen: glVolume is optional, the others have a value now
    expect(screen.queryByText("Required", { selector: "span" })).toBeNull();
  });

  it("lists a dataset WBM cannot read, disabled, and says why under the field", () => {
    section({ state: SWITCH_ON });
    reach();
    fireEvent.click(within(card("Glaciers")).getByRole("button", { name: "Switch on Runoff from Glaciated Areas" }));
    const area = screen.getByLabelText("Glacier area fraction");
    const renamed = within(area).getByRole("option", { name: /Irrigation efficiency .*\(cannot be used\)/ }) as HTMLOptionElement;
    expect(renamed.disabled).toBe(true);
    expect(renamed.title).toContain("fao_irrEfficiency");
    const row = area.closest("[data-param-path]") as HTMLElement;
    fireEvent.click(within(row).getByText("1 dataset cannot be used here"));
    expect(within(row).getByText(/Its Code_Name \(fao_irrEfficiency\) differs/)).toBeTruthy();
  });

  it("lets an optional dataset stay unset", () => {
    const { onChange } = section({ state: SWITCH_ON });
    reach();
    fireEvent.click(within(card("Glaciers")).getByRole("button", { name: "Switch on Runoff from Glaciated Areas" }));
    const volume = screen.getByLabelText("Glacier water volume") as HTMLSelectElement;
    expect((within(volume).getByRole("option", { name: "Not set" }) as HTMLOptionElement).disabled).toBe(false);
    choose("Glacier water volume", "/wbm/data_init/glaciers/volume_y.init");
    expect(last(onChange)).toEqual({ "Glaciers.glVolume": "/wbm/data_init/glaciers/volume_y.init" });
    choose("Glacier water volume", "");
    expect(last(onChange)).toBeNull();
  });

  it("resets: the module is off again, and what was chosen is gone", () => {
    const { onChange } = section({ state: SWITCH_ON, initial: { "Glaciers.glMelt": MELT, "Glaciers.glArea": AREA } });
    reach();
    expect(within(card("Glaciers")).getByText("Switched on")).toBeTruthy();
    fireEvent.click(within(card("Glaciers")).getByRole("button", { name: "Reset Runoff from Glaciated Areas" }));
    expect(last(onChange)).toBeNull();
    expect(within(card("Glaciers")).getByText("Off in this snapshot")).toBeTruthy();
    expect(within(card("Glaciers")).getByRole("button", { name: "Switch on Runoff from Glaciated Areas" })).toBeTruthy();
    expect(within(card("Glaciers")).queryByText("Glacier melt discharge")).toBeNull();
  });

  it("resets a module that was opened and has nothing chosen", () => {
    section({ state: SWITCH_ON });
    reach();
    fireEvent.click(within(card("Glaciers")).getByRole("button", { name: "Switch on Runoff from Glaciated Areas" }));
    fireEvent.click(within(card("Glaciers")).getByRole("button", { name: "Reset Runoff from Glaciated Areas" }));
    expect(within(card("Glaciers")).getByText("Off in this snapshot")).toBeTruthy();
  });

  it("starts a required scalar at WBM's default when it switches on", () => {
    const { onChange } = section({ state: SWITCH_ON });
    reach();
    fireEvent.click(within(card("DIN")).getByRole("button", { name: "Switch on Nitrogen tracking" }));
    expect(last(onChange)).toEqual({ "DIN.scale": "2" });
    expect((screen.getByLabelText("Loading scale") as HTMLInputElement).value).toBe("2");
    fireEvent.click(within(card("DIN")).getByRole("button", { name: "Reset Nitrogen tracking" }));
    expect(last(onChange)).toBeNull();
  });

  it("switches on a module that is itself a dataset by choosing one for its own key, or a constant", () => {
    const { onChange } = section({ state: SWITCH_ON });
    reach();
    fireEvent.click(within(card("Impervious")).getByRole("button", { name: "Switch on Impervious surface runoff" }));
    expect(last(onChange)).toBeNull();
    const dataset = within(card("Impervious")).getByLabelText("Dataset");
    expect(within(dataset).getByRole("option", { name: /Irrigation efficiency .*\(cannot be used\)/ })).toBeTruthy();
    fireEvent.change(dataset, { target: { value: AREA } });
    expect(last(onChange)).toEqual({ Impervious: AREA });
    // a constant goes to the same key, and the select shows no dataset
    const constant = within(card("Impervious")).getByLabelText("Dataset, a constant") as HTMLInputElement;
    fireEvent.change(constant, { target: { value: "0.2" } });
    expect(last(onChange)).toEqual({ Impervious: "0.2" });
    expect((within(card("Impervious")).getByLabelText("Dataset") as HTMLSelectElement).value).toBe("");
    expect((within(card("Impervious")).getByLabelText("Dataset, a constant") as HTMLInputElement).value).toBe("0.2");
    fireEvent.click(within(card("Impervious")).getByRole("button", { name: "Reset Impervious surface runoff" }));
    expect(last(onChange)).toBeNull();
  });

  it("gives a field with no datasets in the model input a constant and nothing to choose from", () => {
    const { onChange } = section({ state: SWITCH_ON });
    reach();
    fireEvent.click(within(card("DIN")).getByRole("button", { name: "Switch on Nitrogen tracking" }));
    const field = screen.getByLabelText("Developed land fraction") as HTMLInputElement;
    expect(field.tagName).toBe("INPUT");
    expect(field.placeholder).toBe("Constant");
    fireEvent.change(field, { target: { value: "0.3" } });
    expect(last(onChange)).toEqual({ "DIN.scale": "2", "DIN.luSub": "0.3" });
  });

  it("shows a module the draft switched on as on when it comes back, from what it sets", () => {
    section({ state: SWITCH_ON, initial: { "Glaciers.glMelt": MELT, "Glaciers.glArea": AREA } });
    reach();
    expect((screen.getByLabelText("Glacier melt discharge") as HTMLSelectElement).value).toBe(MELT);
    expect((screen.getByLabelText("Glacier area fraction") as HTMLSelectElement).value).toBe(AREA);
  });

  it("shows the backend's message for the module at its card, and for a dataset at its field", () => {
    section({
      state: SWITCH_ON,
      initial: { "Glaciers.glMelt": MELT },
      errors: {
        Glaciers: "Runoff from Glaciated Areas is being switched on but does not set Glacier area fraction (Glaciers.glArea).",
        "Glaciers.glMelt": "This is not a dataset of the snapshot's model input.",
      },
    });
    expect(within(card("Glaciers")).getByText(/does not set Glacier area fraction/)).toBeTruthy();
    expect(within(card("Glaciers")).getByText("This is not a dataset of the snapshot's model input.")).toBeTruthy();
  });
});
