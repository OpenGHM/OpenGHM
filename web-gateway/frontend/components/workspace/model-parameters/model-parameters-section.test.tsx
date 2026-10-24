import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ModelParametersSection } from "@/components/workspace/model-parameters/model-parameters-section";
import type { CustomParams, ModelParameters, ParamGroup } from "@/lib/workspace/model-parameters";
import type { ModelParametersState } from "@/lib/workspace/use-model-parameters";
import type { DatasetFork } from "@/lib/workspace/dataset-forks";
import {
  FORK_PRECIP_INIT,
  FORK_REPAIRED_INIT,
  fakeForkTree,
  fakeModelParameters,
  fakeParamField,
  fakeSwitchOnTree,
} from "@/lib/workspace/fixtures";

// The Edit dataset panel reads the original dataset through a server action, which needs no network here.
vi.mock("@/lib/repository/actions", () => ({ fetchDatasetInit: vi.fn() }));

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
  it("opens to the group cards, closed, and a card opens to its basic fields", () => {
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

  it("says in a card's header what it holds and how much of it can be changed", () => {
    section();
    open();
    expect(screen.getByText("3 parameters · 3 editable")).toBeTruthy();
    // 5 fields, the 2 settings of the module (it is on), the module, and what of them can be changed;
    // the 2 advanced fields are not counted while they are hidden
    expect(screen.getByText("7 parameters · 1 module · 6 editable")).toBeTruthy();
    // the subline is the card's description, its title is its name
    const card = screen.getByRole("button", { name: "Run" });
    expect(document.getElementById(card.getAttribute("aria-describedby")!)?.textContent).toBe("3 parameters · 3 editable");
  });

  it("hides the advanced fields until Show advanced is on, and a card says how many it hides", () => {
    section();
    open();
    openGroup(PARAMS);
    expect(screen.getByLabelText("Soil moisture drying coefficient")).toBeTruthy();
    expect(screen.queryByLabelText("Runoff storage limit")).toBeNull();
    expect(screen.queryByLabelText("HBV direct infiltration recharge factor")).toBeNull();
    // no disclosure of its own
    expect(screen.queryByRole("button", { name: "Advanced" })).toBeNull();
    const toggle = screen.getByRole("switch", { name: /^Show advanced/ }) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    expect(screen.getByRole("switch", { name: /^Show advanced/ }).closest("label")!.textContent).toContain("2");
    fireEvent.click(toggle);
    expect(toggle.checked).toBe(true);
    expect(screen.getByLabelText("Runoff storage limit")).toBeTruthy();
    expect(screen.getByLabelText("HBV direct infiltration recharge factor")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Show \d+ advanced$/ })).toBeNull();
    // and off again
    fireEvent.click(toggle);
    expect(screen.queryByLabelText("Runoff storage limit")).toBeNull();
  });

  it("turns Show advanced on from the button at the bottom of a card", () => {
    section();
    open();
    openGroup(PARAMS);
    fireEvent.click(screen.getByRole("button", { name: "Show 2 advanced" }));
    expect((screen.getByRole("switch", { name: /^Show advanced/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByLabelText("Runoff storage limit")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Show \d+ advanced$/ })).toBeNull();
  });

  it("treats everything below an advanced group as advanced, at any depth, with no Advanced disclosure", () => {
    const soil: ParamGroup = {
      kind: "group",
      key: "soil_runoff",
      label: "Soil runoff",
      doc: "How the soil gives water up.",
      tier: "advanced",
      children: [fakeParamField("wbmParam.alpha", { key: "alpha", label: "Soil moisture drying coefficient", tier: "basic", current: "5" })],
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
    // nothing basic is left: no card, and the empty result says why
    expect(screen.queryByRole("button", { name: PARAMS })).toBeNull();
    expect(screen.getByText("Everything here is advanced.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show 1 advanced" }));
    openGroup(PARAMS);
    expect(screen.queryByRole("button", { name: "Advanced" })).toBeNull();
    // the nested group is a heading, not a disclosure
    expect(screen.getByRole("heading", { name: "Soil runoff" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Soil runoff" })).toBeNull();
    expect(screen.getByText("How the soil gives water up.")).toBeTruthy();
    expect(screen.getByLabelText("Soil moisture drying coefficient")).toBeTruthy();
    // the field row is told it is advanced
    expect(screen.getByText("Advanced")).toBeTruthy();
  });

  it("draws a nested group as a heading with its help, over its fields, and a deeper one smaller", () => {
    const tree: ModelParameters = {
      code_version: "23.9.0",
      groups: [
        {
          kind: "group",
          key: "climate",
          label: "Climate",
          doc: "The forcing.",
          tier: "basic",
          children: [
            fakeParamField("A.one", { key: "one", label: "Plain one" }),
            {
              kind: "group",
              key: "extra",
              label: "Additional climate drivers",
              doc: "Drivers beyond precipitation.",
              tier: "basic",
              children: [
                {
                  kind: "group",
                  key: "wind",
                  label: "Wind speed U",
                  doc: null,
                  tier: "basic",
                  children: [fakeParamField("Wind.scale", { key: "scale", label: "Wind scale" })],
                },
              ],
            },
          ],
        },
      ],
    };
    section({ state: { status: "ready", tree } });
    open();
    openGroup("Climate");
    expect(screen.getByText("The forcing.")).toBeTruthy();
    const extra = screen.getByRole("heading", { name: "Additional climate drivers" });
    const wind = screen.getByRole("heading", { name: "Wind speed U" });
    expect(extra.className).toContain("uppercase");
    expect(extra.className).toContain("text-[12px]");
    expect(wind.className).toContain("text-[11px]");
    expect(wind.closest("section")!.className).toContain("pl-3");
    expect(screen.getByText("Drivers beyond precipitation.")).toBeTruthy();
    expect(screen.getByLabelText("Wind scale")).toBeTruthy();
  });

  it("shows a read-only field's value without a control", () => {
    section();
    open();
    openGroup(PARAMS);
    expect(screen.queryByLabelText("Runoff storage release coefficient")).toBeNull();
    expect(screen.getByText("Runoff storage release coefficient")).toBeTruthy();
  });

  it("opens the card that already holds a change, and shows an advanced field that holds one", () => {
    section({ initial: { "wbmParam.maxRffStorage": "500" } });
    open();
    expect((screen.getByLabelText("Runoff storage limit") as HTMLInputElement).value).toBe("500");
    // the other advanced field stays hidden, and the card says what is left
    expect(screen.queryByLabelText("HBV direct infiltration recharge factor")).toBeNull();
    expect(screen.getByRole("button", { name: "Show 1 advanced" })).toBeTruthy();
    const card = screen.getByRole("button", { name: PARAMS });
    expect(card.getAttribute("aria-expanded")).toBe("true");
    expect(card.textContent).toContain("1 changed");
    expect(screen.getByRole("button", { name: "Run" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps a card the person closed closed when its change is reset", () => {
    section({ initial: { "wbmParam.alpha": "7" } });
    open();
    fireEvent.click(screen.getByRole("button", { name: "Reset Soil moisture drying coefficient" }));
    expect(screen.getByRole("button", { name: PARAMS }).getAttribute("aria-expanded")).toBe("true");
    openDisclosure(PARAMS);
    expect(screen.queryByLabelText("Soil moisture drying coefficient")).toBeNull();
  });
});

describe("the Model parameters section: search, filters and Reset all", () => {
  const searchBox = () => screen.getByRole("searchbox", { name: "Search model parameters" }) as HTMLInputElement;
  const search = (text: string) => fireEvent.change(searchBox(), { target: { value: text } });
  const segment = (name: RegExp | string) => screen.getByRole("button", { name });

  it("has a search box, the three filters with the change count, and no Reset all while nothing changed", () => {
    section();
    open();
    expect(searchBox().placeholder).toBe("Search parameters or init keys");
    expect(segment("All").getAttribute("aria-pressed")).toBe("true");
    expect(segment("Editable").getAttribute("aria-pressed")).toBe("false");
    expect(segment("Changed 0").getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByRole("button", { name: "Reset all" })).toBeNull();
  });

  it("searches the label, the key path, the key and the help text, and opens what it finds", () => {
    section();
    open();
    search("DRYING");
    // the group opens by itself, and only the field that matches is left in it
    expect(screen.getByRole("button", { name: PARAMS }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByLabelText("Soil moisture drying coefficient")).toBeTruthy();
    expect(screen.queryByLabelText("Infiltration method")).toBeNull();
    expect(screen.queryByRole("button", { name: "Run" })).toBeNull();
    search("wbmparam.maxrff");
    expect(screen.getByLabelText("Runoff storage limit")).toBeTruthy();
    expect(screen.queryByLabelText("Soil moisture drying coefficient")).toBeNull();
    search("max_rff_storage");
    expect(screen.getByLabelText("Runoff storage limit")).toBeTruthy();
    search("AET less water-limited");
    expect(screen.getByLabelText("Soil moisture drying coefficient")).toBeTruthy();
  });

  it("searches advanced fields too, without Show advanced", () => {
    section();
    open();
    search("HBV");
    expect(screen.getByLabelText("HBV direct infiltration recharge factor")).toBeTruthy();
    expect((screen.getByRole("switch", { name: /^Show advanced/ }) as HTMLInputElement).checked).toBe(false);
  });

  it("marks the search text in the label of a field", () => {
    section();
    open();
    search("drying");
    const mark = document.querySelector("mark");
    expect(mark?.textContent?.toLowerCase()).toBe("drying");
  });

  it("shows a whole group when its label matches, and a module by its name, path or help text", () => {
    section();
    open();
    search("spin");
    // "Run" does not match "spin": only the field "Spin-up loops" and "Spin-up start" are found, by label
    expect(screen.getByLabelText("Spin-up loops")).toBeTruthy();
    expect(screen.queryByLabelText("Run description")).toBeNull();
    search("run");
    // the label "Run" matches: everything below it is shown (and, by other labels, other groups)
    expect(screen.getByLabelText("Run description")).toBeTruthy();
    expect(screen.getByLabelText("Spin-up start")).toBeTruthy();
    search("glaciated");
    expect(document.querySelector('[data-param-path="Glaciers"]')).toBeTruthy();
    expect(screen.queryByLabelText("Soil moisture drying coefficient")).toBeNull();
    search("rasterized glacier");
    expect(document.querySelector('[data-param-path="Glaciers"]')).toBeTruthy();
    search("Glaciers");
    expect(document.querySelector('[data-param-path="Glaciers"]')).toBeTruthy();
    // a module that matches shows its settings, which it is on for
    expect(screen.getByLabelText("Glacier melt ratio")).toBeTruthy();
  });

  it("clears the search with the X and with Escape", () => {
    section();
    open();
    search("drying");
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(searchBox().value).toBe("");
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
    expect(screen.getByRole("button", { name: "Run" })).toBeTruthy();
    search("drying");
    fireEvent.keyDown(searchBox(), { key: "Escape" });
    expect(searchBox().value).toBe("");
  });

  it("says nothing matches, and clears the search from there", () => {
    section();
    open();
    search("zzz");
    expect(screen.getByText("No parameters match “zzz”.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Run" })).toBeNull();
    // the X in the box and the button under the message both clear it
    const clear = within(screen.getByText("No parameters match “zzz”.").parentElement!).getByRole("button", {
      name: "Clear search",
    });
    fireEvent.click(clear);
    expect(searchBox().value).toBe("");
    expect(screen.getByRole("button", { name: "Run" })).toBeTruthy();
  });

  it("keeps the Editable filter to the fields the wizard can change and the modules it can switch", () => {
    section();
    open();
    fireEvent.click(segment("Editable"));
    expect(segment("Editable").getAttribute("aria-pressed")).toBe("true");
    // the cards stay open while a filter is on
    expect(screen.getByLabelText("Soil moisture drying coefficient")).toBeTruthy();
    expect(screen.queryByLabelText("Runoff storage release coefficient")).toBeNull();
    expect(screen.queryByText("Runoff storage release coefficient")).toBeNull();
    expect(screen.getByRole("switch", { name: "Runoff from Glaciated Areas" })).toBeTruthy();
    // back to All, the cards are as the person left them: closed
    fireEvent.click(segment("All"));
    expect(screen.getByRole("button", { name: PARAMS }).getAttribute("aria-expanded")).toBe("false");
    openDisclosure(PARAMS);
    expect(screen.getByText("Runoff storage release coefficient")).toBeTruthy();
  });

  it("counts a dataset the draft can copy as editable", () => {
    const FORKS: ModelParametersState = { status: "ready", tree: fakeForkTree() };
    render(<ModelParametersSection state={FORKS} datasetId="snap-1" custom={null} onChange={() => {}} />);
    open();
    fireEvent.click(segment("Editable"));
    expect(document.querySelector('[data-param-path="MT_Precip.Primary"]')).toBeTruthy();
    cleanup();
    // a dataset field the tree allows no copy of is not
    const tree = fakeForkTree();
    const group = tree.groups[0];
    if (group.kind === "group" && group.children[0].kind === "field") group.children[0].forkable = false;
    render(<ModelParametersSection state={{ status: "ready", tree }} datasetId="snap-1" custom={null} onChange={() => {}} />);
    open();
    fireEvent.click(segment("Editable"));
    expect(document.querySelector('[data-param-path="MT_Precip.Primary"]')).toBeNull();
  });

  it("keeps the Changed filter to what the draft changes, with the count, and a way back", () => {
    section({ initial: { "wbmParam.alpha": "7", Glaciers: "" } });
    open();
    expect(segment("Changed 2")).toBeTruthy();
    fireEvent.click(segment("Changed 2"));
    expect(screen.getByLabelText("Soil moisture drying coefficient")).toBeTruthy();
    expect(screen.queryByLabelText("Infiltration method")).toBeNull();
    expect(screen.queryByRole("button", { name: "Run" })).toBeNull();
    expect(screen.getByRole("switch", { name: "Runoff from Glaciated Areas" })).toBeTruthy();
  });

  it("says no parameter is changed yet when the Changed filter has nothing", () => {
    section();
    open();
    fireEvent.click(segment("Changed 0"));
    expect(screen.getByText("No changed parameters yet.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(segment("All").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Run" })).toBeTruthy();
  });

  it("combines the search with the filter, and offers to clear both", () => {
    section({ initial: { "wbmParam.alpha": "7" } });
    open();
    fireEvent.click(segment("Changed 1"));
    search("storage");
    expect(screen.getByText("No parameters match “storage”.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear search and filter" }));
    expect(segment("All").getAttribute("aria-pressed")).toBe("true");
    expect(searchBox().value).toBe("");
  });

  it("resets everything after a confirmation: the changes, the copies and the modules switched on", () => {
    const calls: [CustomParams | null, DatasetFork[] | null | undefined][] = [];
    const fork = { path: "MT_Precip.Primary", original: FORK_PRECIP_INIT, set: { Var_Scale: "2" } };
    function Harness() {
      const [custom, setCustom] = useState<CustomParams | null>({ "MT_Precip.Scale": "1.5", Glaciers: "" });
      const [held, setForks] = useState<DatasetFork[] | null>([fork]);
      return (
        <ModelParametersSection
          state={{ status: "ready", tree: fakeForkTree() }}
          datasetId="snap-1"
          custom={custom}
          forks={held}
          onChange={(next, nextForks) => {
            calls.push([next, nextForks]);
            setCustom(next);
            if (nextForks !== undefined) setForks(nextForks);
          }}
        />
      );
    }
    render(<Harness />);
    open();
    expect(screen.getByText("WBM 23.9.0 · 3 parameters changed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reset all" }));
    const dialog = screen.getByRole("alertdialog", { name: "Reset all model parameters?" });
    expect(within(dialog).getByText(/3 changes will be removed/)).toBeTruthy();
    // Keep changes leaves everything as it is
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep changes" }));
    expect(calls).toHaveLength(0);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reset all" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Reset all" }));
    expect(calls.at(-1)).toEqual([null, null]);
    expect(screen.getByText("WBM 23.9.0 · No parameters changed")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reset all" })).toBeNull();
  });

  it("forgets the modules it had open when everything is reset", () => {
    const tree = fakeSwitchOnTree();
    const { onChange } = section({ state: { status: "ready", tree }, initial: { "Glaciers.glMelt": "/wbm/data_init/glaciers/discharge_m.init" } });
    open();
    openGroup(/^Modules/);
    fireEvent.click(screen.getByRole("switch", { name: "Nitrogen tracking" }));
    expect(screen.getByLabelText("Loading scale")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reset all" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Reset all" }));
    expect(last(onChange)).toBeNull();
    expect(screen.queryByLabelText("Loading scale")).toBeNull();
    expect(screen.queryByLabelText("Glacier melt discharge")).toBeNull();
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
    expect(within(document.querySelector('[data-param-path="wbmParam.alpha"]') as HTMLElement).getByText("Changed")).toBeTruthy();
    // and the toolbar and the card say so
    expect(screen.getByRole("button", { name: "Changed 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: PARAMS }).textContent).toContain("1 changed");
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
  const toggle = () => within(card()).getByRole("switch", { name: "Runoff from Glaciated Areas" }) as HTMLInputElement;
  const reach = () => {
    open();
    openGroup(PARAMS);
  };

  it("is a row that says the module is on, with its key and a switch that is on", () => {
    section();
    reach();
    expect(within(card()).getByRole("heading", { name: "Runoff from Glaciated Areas" })).toBeTruthy();
    expect(within(card()).getByText("On")).toBeTruthy();
    expect(within(card()).getByText("Glaciers")).toBeTruthy();
    expect(toggle().checked).toBe(true);
    expect(toggle().disabled).toBe(false);
    // no buttons: the switch does what Switch on, Switch off and Reset did
    expect(within(card()).queryByRole("button", { name: /Switch|Reset/ })).toBeNull();
    expect(within(card()).queryByText("Changed")).toBeNull();
  });

  it("switches off with an empty value on the module's own key, says so, and switches back on", () => {
    const { onChange } = section({ initial: { "Glaciers.glRatio": "2" } });
    reach();
    fireEvent.click(toggle());
    // What its parameters were set to goes with it.
    expect(last(onChange)).toEqual({ Glaciers: "" });
    expect(toggle().checked).toBe(false);
    expect(within(card()).getByText("Switched off")).toBeTruthy();
    expect(within(card()).getByText("Changed")).toBeTruthy();
    expect(screen.getByText("WBM 22.1.1 · 1 parameter changed")).toBeTruthy();
    // switching it on again is the Reset: the snapshot's module is back
    fireEvent.click(toggle());
    expect(last(onChange)).toBeNull();
    expect(toggle().checked).toBe(true);
    expect(within(card()).getByText("On")).toBeTruthy();
  });

  it("shows the module's own settings in place, while it is on", () => {
    section();
    reach();
    // no Settings disclosure
    expect(within(card()).queryByRole("button", { name: "Settings" })).toBeNull();
    expect(within(card()).getByLabelText("Glacier melt ratio")).toBeTruthy();
    fireEvent.change(within(card()).getByLabelText("Glacier melt ratio"), { target: { value: "2" } });
    expect(card().getAttribute("data-changed")).toBe("true");
    fireEvent.click(toggle());
    expect(within(card()).queryByText("Glacier melt ratio")).toBeNull();
  });

  it("disables the switch when the tree does not allow switching the module off, and for a module that cannot be on", () => {
    const tree = fakeModelParameters();
    const mod = tree.groups[1].kind === "group" ? tree.groups[1].children.find((n) => n.kind === "module") : null;
    if (mod?.kind !== "module") throw new Error("fixture has no module");
    mod.switch_off = false;
    section({ state: { status: "ready", tree } });
    reach();
    expect(toggle().checked).toBe(true);
    expect(toggle().disabled).toBe(true);
    expect(within(card()).getByText("On")).toBeTruthy();
    fireEvent.click(toggle());
    cleanup();

    // off in the snapshot and not switchable: it is in the gathered list, not a row
    mod.switch_off = true;
    mod.state = "off";
    mod.switch_on = false;
    mod.switch_on_reason = "It needs a file.";
    section({ state: { status: "ready", tree } });
    reach();
    expect(screen.queryByRole("switch", { name: "Runoff from Glaciated Areas" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "1 module can't be switched on here" }));
    expect(screen.getByText("It needs a file.")).toBeTruthy();
  });

  it("clamps a long help text to two lines, with More and Less", () => {
    const tree = fakeModelParameters();
    const mod = tree.groups[1].kind === "group" ? tree.groups[1].children.find((n) => n.kind === "module") : null;
    if (mod?.kind !== "module") throw new Error("fixture has no module");
    mod.doc = "WBM reads rasterized glacier area and glacier runoff. ".repeat(6).trim();
    section({ state: { status: "ready", tree } });
    reach();
    const text = within(card()).getByText(/^WBM reads rasterized glacier area/);
    expect(text.className).toContain("line-clamp-2");
    fireEvent.click(within(card()).getByRole("button", { name: "More" }));
    expect(text.className).not.toContain("line-clamp-2");
    fireEvent.click(within(card()).getByRole("button", { name: "Less" }));
    expect(text.className).toContain("line-clamp-2");
  });

  it("gives a short help text no More button", () => {
    section();
    reach();
    expect(within(card()).getByText("WBM reads rasterized glacier area and glacier runoff.").className).not.toContain("line-clamp-2");
    expect(within(card()).queryByRole("button", { name: "More" })).toBeNull();
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

  it("keeps a module that cannot be switched on out of the gathered list when the backend has a message for it", () => {
    section({ state: { status: "ready", tree: fakeSwitchOnTree() }, errors: { Irrigation: "This module cannot be switched on." } });
    expect(screen.getByRole("heading", { name: "Irrigated crops" })).toBeTruthy();
    expect(screen.getByText("This module cannot be switched on.")).toBeTruthy();
    expect((screen.getByRole("switch", { name: "Irrigated crops" }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /can't be switched on here/ })).toBeNull();
  });

  it("shows an advanced field with a message even while a filter would hide the rest, and marks its card", () => {
    section({
      initial: { "wbmParam.maxRffStorage": "-5" },
      errors: { "wbmParam.maxRffStorage": "Must be at least 0." },
    });
    expect(screen.getByLabelText("Runoff storage limit")).toBeTruthy();
    expect(within(screen.getByRole("button", { name: PARAMS })).getByText("Has a message from the backend")).toBeTruthy();
    expect(screen.getByRole("button", { name: PARAMS }).getAttribute("aria-expanded")).toBe("true");
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

  it("gives a module the snapshot has off and the backend says can be on a switch that is off", () => {
    section({ state: SWITCH_ON });
    reach();
    expect(within(card("Glaciers")).getByText("Off")).toBeTruthy();
    const toggle = within(card("Glaciers")).getByRole("switch", { name: "Runoff from Glaciated Areas" }) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    expect(toggle.disabled).toBe(false);
    // none of its fields is shown until it is on
    expect(within(card("Glaciers")).queryByText("Glacier melt discharge")).toBeNull();
  });

  it("gathers a module that cannot be switched on in one closed list, and says why for each when it is opened", () => {
    section({ state: SWITCH_ON });
    reach();
    // not a row of its own, and nothing of it is shown
    expect(screen.queryByRole("switch", { name: "Irrigated crops" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Irrigated crops" })).toBeNull();
    expect(card("Irrigation")).toBeNull();
    const list = screen.getByRole("button", { name: "1 module can't be switched on here" });
    expect(list.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(list);
    expect(list.getAttribute("aria-expanded")).toBe("true");
    const irrigation = card("Irrigation");
    expect(within(irrigation).getByText("Irrigated crops")).toBeTruthy();
    expect(within(irrigation).getByText(/^It needs a file, which cannot be chosen here yet/)).toBeTruthy();
    expect(within(irrigation).queryByRole("button")).toBeNull();
    expect(within(irrigation).queryByRole("switch")).toBeNull();
    expect(within(irrigation).queryByText("Return coefficient")).toBeNull();
    fireEvent.click(list);
    expect(card("Irrigation")).toBeNull();
  });

  it("finds a module that cannot be switched on by search, and opens the list", () => {
    section({ state: SWITCH_ON });
    open();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "irrigated" } });
    expect(within(card("Irrigation")).getByText("Irrigated crops")).toBeTruthy();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("keeps a module that cannot be switched on out of the Editable filter", () => {
    section({ state: SWITCH_ON });
    open();
    fireEvent.click(screen.getByRole("button", { name: "Editable" }));
    expect(screen.queryByRole("button", { name: /can't be switched on here/ })).toBeNull();
    expect(screen.getByRole("switch", { name: "Runoff from Glaciated Areas" })).toBeTruthy();
  });

  it("switches on: the module's required datasets are chosen from the model input's, each by name", () => {
    const { onChange } = section({ state: SWITCH_ON });
    reach();
    fireEvent.click(within(card("Glaciers")).getByRole("switch", { name: "Runoff from Glaciated Areas" }));
    // nothing is chosen yet, so there is nothing to keep: the module is open, not changed
    expect(last(onChange)).toBeNull();
    expect(within(card("Glaciers")).getByText("Switched on")).toBeTruthy();
    expect((within(card("Glaciers")).getByRole("switch", { name: "Runoff from Glaciated Areas" }) as HTMLInputElement).checked).toBe(true);
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
    fireEvent.click(within(card("Glaciers")).getByRole("switch", { name: "Runoff from Glaciated Areas" }));
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
    fireEvent.click(within(card("Glaciers")).getByRole("switch", { name: "Runoff from Glaciated Areas" }));
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
    fireEvent.click(within(card("Glaciers")).getByRole("switch", { name: "Runoff from Glaciated Areas" }));
    expect(last(onChange)).toBeNull();
    expect(within(card("Glaciers")).getByText("Off")).toBeTruthy();
    expect(within(card("Glaciers")).getByRole("switch", { name: "Runoff from Glaciated Areas" })).toBeTruthy();
    expect(within(card("Glaciers")).queryByText("Glacier melt discharge")).toBeNull();
  });

  it("resets a module that was opened and has nothing chosen", () => {
    section({ state: SWITCH_ON });
    reach();
    fireEvent.click(within(card("Glaciers")).getByRole("switch", { name: "Runoff from Glaciated Areas" }));
    fireEvent.click(within(card("Glaciers")).getByRole("switch", { name: "Runoff from Glaciated Areas" }));
    expect(within(card("Glaciers")).getByText("Off")).toBeTruthy();
  });

  it("starts a required scalar at WBM's default when it switches on", () => {
    const { onChange } = section({ state: SWITCH_ON });
    reach();
    fireEvent.click(within(card("DIN")).getByRole("switch", { name: "Nitrogen tracking" }));
    expect(last(onChange)).toEqual({ "DIN.scale": "2" });
    expect((screen.getByLabelText("Loading scale") as HTMLInputElement).value).toBe("2");
    fireEvent.click(within(card("DIN")).getByRole("switch", { name: "Nitrogen tracking" }));
    expect(last(onChange)).toBeNull();
  });

  it("switches on a module that is itself a dataset by choosing one for its own key, or a constant", () => {
    const { onChange } = section({ state: SWITCH_ON });
    reach();
    fireEvent.click(within(card("Impervious")).getByRole("switch", { name: "Impervious surface runoff" }));
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
    fireEvent.click(within(card("Impervious")).getByRole("switch", { name: "Impervious surface runoff" }));
    expect(last(onChange)).toBeNull();
  });

  it("gives a field with no datasets in the model input a constant and nothing to choose from", () => {
    const { onChange } = section({ state: SWITCH_ON });
    reach();
    fireEvent.click(within(card("DIN")).getByRole("switch", { name: "Nitrogen tracking" }));
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

describe("the Model parameters section: dataset forks", () => {
  const FORKS: ModelParametersState = { status: "ready", tree: fakeForkTree() };
  const AREA = "/wbm/data_init/glaciers/area_1km.init";
  const MELT = "/wbm/data_init/glaciers/discharge_m.init";
  const card = (path: string) => document.querySelector(`[data-param-path="${path}"]`) as HTMLElement;

  /** The section with `custom_params` and the forks as state; `calls` has every change as the run
   *  step gets it: the custom parameters, and the forks only when they changed too. */
  function forkSection({
    initial = null,
    forks = null,
    errors,
  }: { initial?: CustomParams | null; forks?: DatasetFork[] | null; errors?: Record<string, string> } = {}) {
    const calls: [CustomParams | null, DatasetFork[] | null | undefined][] = [];
    function Harness() {
      const [custom, setCustom] = useState<CustomParams | null>(initial);
      const [held, setForks] = useState<DatasetFork[] | null>(forks);
      return (
        <ModelParametersSection
          state={FORKS}
          datasetId="snap-1"
          custom={custom}
          forks={held}
          errors={errors}
          onChange={(next, nextForks) => {
            calls.push(nextForks === undefined ? [next, undefined] : [next, nextForks]);
            setCustom(next);
            if (nextForks !== undefined) setForks(nextForks);
          }}
        />
      );
    }
    const view = render(<Harness />);
    // a message from the backend holds the section open
    if (!errors) open();
    openGroup(/^Climate forcing/);
    return { calls, ...view };
  }

  it("offers Edit dataset on a field that reads a data init and the tree says can be copied, and on no other", () => {
    forkSection();
    expect(within(card("MT_Precip.Primary")).getByRole("button", { name: "Edit dataset merra2_prectotcorr_d.init" })).toBeTruthy();
    expect(within(card("MT_Precip.Scale")).queryByRole("button", { name: /Edit dataset/ })).toBeNull();
  });

  it("copies the dataset with a value set: the forks change, the custom parameters do not", () => {
    const { calls } = forkSection();
    fireEvent.click(screen.getByRole("button", { name: /Edit dataset/ }));
    fireEvent.change(screen.getByLabelText("Var_Scale"), { target: { value: "95040" } });
    expect(calls.at(-1)).toEqual([
      null,
      [{ path: "MT_Precip.Primary", original: FORK_PRECIP_INIT, set: { Var_Scale: "95040" } }],
    ]);
    // the field says it changed, the heading counts it, and the card has a Reset
    expect(card("MT_Precip.Primary").getAttribute("data-changed")).toBe("true");
    expect(screen.getByText("WBM 23.9.0 · 1 parameter changed")).toBeTruthy();
  });

  it("resets a copied field: the copy goes", () => {
    const fork = { path: "MT_Precip.Primary", original: FORK_PRECIP_INIT, set: { Var_Scale: "2" } };
    const { calls } = forkSection({ forks: [fork] });
    fireEvent.click(within(card("MT_Precip.Primary")).getByRole("button", { name: "Reset Primary dataset" }));
    expect(calls.at(-1)).toEqual([null, null]);
    expect(card("MT_Precip.Primary").getAttribute("data-changed")).toBeNull();
    expect(screen.getByText("WBM 23.9.0 · No parameters changed")).toBeTruthy();
  });

  it("counts a field once when it has both a value and a copy, and says a group holds the change", () => {
    forkSection({
      initial: { "MT_Precip.Scale": "1.2" },
      forks: [{ path: "MT_Precip.Primary", original: FORK_PRECIP_INIT, set: { Units: "mm/day" } }],
    });
    expect(screen.getByText("WBM 23.9.0 · 2 parameters changed")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Climate forcing/ }).textContent).toContain("2 changed");
  });

  describe("a module being switched on", () => {
    const reach = () => {
      openGroup(/^Modules/);
      fireEvent.click(within(card("Glaciers")).getByRole("switch", { name: "Runoff from Glaciated Areas" }));
    };
    const choose = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

    it("chooses a dataset WBM reads without a copy, and a repaired one with a copy that sets nothing", () => {
      const { calls } = forkSection();
      reach();
      choose("Glacier area fraction", AREA);
      expect(calls.at(-1)).toEqual([{ "Glaciers.glArea": AREA }, undefined]);
      choose("Glacier area fraction", FORK_REPAIRED_INIT);
      expect(calls.at(-1)).toEqual([
        { "Glaciers.glArea": FORK_REPAIRED_INIT },
        [{ path: "Glaciers.glArea", original: FORK_REPAIRED_INIT, set: {} }],
      ]);
      // the repaired dataset is offered as a choice, not disabled, and the card says what the copy repairs
      const option = within(screen.getByLabelText("Glacier area fraction")).getByRole("option", { name: /Irrigation efficiency/ });
      expect((option as HTMLOptionElement).disabled).toBe(false);
      expect(screen.getByRole("group", { name: "Edit dataset irrEfficiency.init" }).textContent).toContain(
        "differs from its file name"
      );
      // choosing another dataset takes the copy away with the repaired one
      choose("Glacier area fraction", AREA);
      expect(calls.at(-1)).toEqual([{ "Glaciers.glArea": AREA }, null]);
    });

    it("resets the module: what was chosen and its copies are gone", () => {
      const { calls } = forkSection();
      reach();
      choose("Glacier melt discharge", MELT);
      choose("Glacier area fraction", FORK_REPAIRED_INIT);
      fireEvent.click(within(card("Glaciers")).getByRole("switch", { name: "Runoff from Glaciated Areas" }));
      expect(calls.at(-1)).toEqual([null, null]);
      expect(screen.getByText("WBM 23.9.0 · No parameters changed")).toBeTruthy();
    });
  });

  it("shows a message of the backend at the field of a copy, with the panel open", () => {
    forkSection({
      forks: [{ path: "MT_Precip.Primary", original: FORK_PRECIP_INIT, set: { Var_Scale: "x" } }],
      errors: { "MT_Precip.Primary": "Var_Scale must be a number like 1.1 or 2e-3." },
    });
    expect(within(card("MT_Precip.Primary")).getByText("Var_Scale must be a number like 1.1 or 2e-3.", { selector: "p.text-destructive" })).toBeTruthy();
  });

  it("lists a copy the tree has no field for, and removes it", () => {
    const calls: [CustomParams | null, DatasetFork[] | null | undefined][] = [];
    render(
      <ModelParametersSection
        state={{ status: "unavailable" }}
        datasetId="snap-1"
        custom={null}
        forks={[{ path: "MT_Precip.Primary", original: FORK_PRECIP_INIT, set: { Var_Scale: "2" } }]}
        onChange={(next, forks) => calls.push([next, forks])}
      />
    );
    open();
    expect(screen.getByText("MT_Precip.Primary: copy of merra2_prectotcorr_d.init, Var_Scale 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove MT_Precip.Primary" }));
    expect(calls.at(-1)).toEqual([null, null]);
  });
});
