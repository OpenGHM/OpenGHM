import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { FIELD_CONTROLS, ParamFieldRow } from "@/components/workspace/model-parameters/registry";
import { allFields, type CustomParams, type FieldType, type ParamField } from "@/lib/workspace/model-parameters";
import { fakeModelParameters, fakeParamField } from "@/lib/workspace/fixtures";

// The Edit dataset panel reads the original dataset through a server action, which needs no network here.
vi.mock("@/lib/repository/actions", () => ({ fetchDatasetInit: vi.fn() }));

afterEach(cleanup);

const fields = allFields(fakeModelParameters().groups);
const field = (path: string): ParamField => fields.find((f) => f.path === path)!;

function row(f: ParamField, custom: CustomParams | null = null, error?: string) {
  const onChange = vi.fn();
  const onReset = vi.fn();
  const view = render(<ParamFieldRow field={f} custom={custom} error={error} onChange={onChange} onReset={onReset} />);
  return { onChange, onReset, ...view };
}

describe("the registry", () => {
  it("has a component for every field type of the contract", () => {
    const types: FieldType[] = [
      "number", "int", "enum", "bool01", "string", "date",
      "dataset", "file", "list", "column", "block", "flag",
    ];
    for (const type of types) expect(FIELD_CONTROLS[type]).toBeTypeOf("function");
    expect(Object.keys(FIELD_CONTROLS).sort()).toEqual([...types].sort());
  });
});

describe("a number field", () => {
  it("is a number input with the snapshot's value, its unit and its bounds", () => {
    row(field("wbmParam.maxRffStorage"));
    const input = screen.getByLabelText("Runoff storage limit") as HTMLInputElement;
    expect(input.type).toBe("number");
    expect(input.value).toBe("1000");
    expect(input.step).toBe("any");
    expect(input.min).toBe("0");
    expect(input.max).toBe("");
    expect(screen.getByText("mm", { selector: "span" })).toBeTruthy();
  });

  it("reports what is typed, as text", () => {
    const { onChange } = row(field("wbmParam.alpha"));
    fireEvent.change(screen.getByLabelText("Soil moisture drying coefficient"), { target: { value: "7.5" } });
    expect(onChange).toHaveBeenCalledWith("7.5");
  });

  it("shows the draft's value, not the snapshot's, when it has one", () => {
    row(field("wbmParam.alpha"), { "wbmParam.alpha": "9" });
    expect((screen.getByLabelText("Soil moisture drying coefficient") as HTMLInputElement).value).toBe("9");
  });
});

describe("an int field", () => {
  it("steps by 1", () => {
    row(field("Spinup.Loops"));
    const input = screen.getByLabelText("Spin-up loops") as HTMLInputElement;
    expect(input.type).toBe("number");
    expect(input.step).toBe("1");
    expect(input.min).toBe("0");
  });
});

describe("an enum field", () => {
  it("is a select of the options, by their labels, on the snapshot's value", () => {
    const { onChange } = row(field("wbmParam.Infiltration"));
    const select = screen.getByLabelText("Infiltration method") as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    expect(select.value).toBe("FrAMES");
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["FrAMES", "HBV"]);
    fireEvent.change(select, { target: { value: "HBV" } });
    expect(onChange).toHaveBeenCalledWith("HBV");
  });

  it("lists a value the options do not have, so the select can show it", () => {
    row(field("wbmParam.Infiltration"), { "wbmParam.Infiltration": "other" });
    const select = screen.getByLabelText("Infiltration method") as HTMLSelectElement;
    expect(select.value).toBe("other");
  });

  it("offers a label that differs from its value", () => {
    row({
      ...field("wbmParam.Infiltration"),
      options: [
        { value: "FrAMES", label: "FrAMES (default)" },
        { value: "HBV", label: "HBV bucket model" },
      ],
    });
    expect(screen.getByRole("option", { name: "HBV bucket model" })).toBeTruthy();
  });
});

describe("a bool01 field", () => {
  it("is a switch that writes 1 and 0", () => {
    const { onChange } = row(field("wbmParam.endorheicDir"));
    const sw = screen.getByRole("switch", { name: "Endorheic directions" }) as HTMLInputElement;
    expect(sw.checked).toBe(false);
    fireEvent.click(sw);
    expect(onChange).toHaveBeenLastCalledWith("1");
  });

  it("is on for 1 and writes 0 when switched off", () => {
    const { onChange } = row(field("wbmParam.endorheicDir"), { "wbmParam.endorheicDir": "1" });
    const sw = screen.getByRole("switch", { name: "Endorheic directions" }) as HTMLInputElement;
    expect(sw.checked).toBe(true);
    fireEvent.click(sw);
    expect(onChange).toHaveBeenLastCalledWith("0");
  });
});

describe("a string field", () => {
  it("is a text input", () => {
    const { onChange } = row(field("Comment"));
    const input = screen.getByLabelText("Run description") as HTMLInputElement;
    expect(input.type).toBe("text");
    expect(input.value).toBe("Wyoming baseline");
    fireEvent.change(input, { target: { value: "Changed" } });
    expect(onChange).toHaveBeenCalledWith("Changed");
  });
});

describe("a date field", () => {
  it("is a date input", () => {
    const { onChange } = row(field("Spinup.Start"));
    const input = screen.getByLabelText("Spin-up start") as HTMLInputElement;
    expect(input.type).toBe("date");
    expect(input.value).toBe("2001-01-01");
    fireEvent.change(input, { target: { value: "2002-01-01" } });
    expect(onChange).toHaveBeenCalledWith("2002-01-01");
  });
});

describe("a dataset field that WBM also accepts as a constant number (edit_as number)", () => {
  const beta = () => field("wbmParam.groundWatBETA");

  it("is a number input, empty while the snapshot has a path, with a note about the constant", () => {
    row(beta());
    const input = screen.getByLabelText("Groundwater baseflow coefficient") as HTMLInputElement;
    expect(input.type).toBe("number");
    expect(input.value).toBe("");
    expect(screen.queryByText("Read-only")).toBeNull();
    // the snapshot's value is shown as the path text
    expect(screen.getByText(/In this snapshot: \/wbm\/data_init\/groundwater\/beta\.init/)).toBeTruthy();
    expect(screen.getByText(/replaces the dataset with that constant for every grid cell/)).toBeTruthy();
    expect(screen.getByText("1/day", { selector: "span" })).toBeTruthy();
  });

  it("reports the number typed, as text", () => {
    const { onChange } = row(beta());
    fireEvent.change(screen.getByLabelText("Groundwater baseflow coefficient"), { target: { value: "0.02" } });
    expect(onChange).toHaveBeenCalledWith("0.02");
  });

  it("shows the draft's constant, and a Reset", () => {
    const { onReset } = row(beta(), { "wbmParam.groundWatBETA": "0.05" });
    expect((screen.getByLabelText("Groundwater baseflow coefficient") as HTMLInputElement).value).toBe("0.05");
    fireEvent.click(screen.getByRole("button", { name: "Reset Groundwater baseflow coefficient" }));
    expect(onReset).toHaveBeenCalled();
  });

  it("shows a snapshot's own number in the box", () => {
    row({ ...beta(), current: "0.0167" });
    expect((screen.getByLabelText("Groundwater baseflow coefficient") as HTMLInputElement).value).toBe("0.0167");
  });

  it("stays read-only when the backend says editable is false (its module is off)", () => {
    row({ ...beta(), editable: false });
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(screen.getByText("Read-only")).toBeTruthy();
  });

  it("is not a number field without edit_as: a dataset stays read-only", () => {
    row({ ...beta(), edit_as: null });
    expect(screen.queryByRole("spinbutton")).toBeNull();
  });
});

describe("a field the wizard does not change", () => {
  it("shows the snapshot's value as text and has no input", () => {
    row(field("wbmParam.RhRt2"));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(screen.getByText("Read-only")).toBeTruthy();
    expect(screen.getAllByText("0.56").length).toBeGreaterThan(0);
  });

  it("shows every other non-scalar type the same way, and a missing value as Not set", () => {
    for (const type of ["dataset", "file", "list", "column", "block", "flag"] as const) {
      const { unmount } = row({ ...field("wbmParam.RhRt2"), type, current: type === "flag" ? null : `${type}-value` });
      expect(screen.queryByRole("spinbutton")).toBeNull();
      expect(screen.getByText(type === "flag" ? "Not set" : `${type}-value`, { selector: "code" })).toBeTruthy();
      unmount();
    }
  });

  it("is read-only when the tree says editable is false, whatever its type", () => {
    row({ ...field("wbmParam.alpha"), editable: false });
    expect(screen.queryByRole("spinbutton")).toBeNull();
  });
});

describe("what a row says around its control", () => {
  it("names the init key, the snapshot's value, and the help text", () => {
    row(field("wbmParam.alpha"));
    expect(screen.getByText("wbmParam.alpha")).toBeTruthy();
    expect(screen.getByText(/In this snapshot: 5/)).toBeTruthy();
    expect(screen.getByText(/larger alpha makes AET/)).toBeTruthy();
  });

  it("gives the default only when it differs, the calibration range, and the bounds", () => {
    row(field("wbmParam.alpha"));
    expect(screen.getByText(/Usually calibrated within 1–20/)).toBeTruthy();
    expect(screen.queryByText(/WBM's default/)).toBeNull();
    cleanup();
    row({ ...field("wbmParam.alpha"), current: "6", min: 0, max: 30, unit: "-" });
    expect(screen.getByText(/WBM's default: 5 -/)).toBeTruthy();
    expect(screen.getByText(/Allowed: 0–30 -/)).toBeTruthy();
  });

  it("states a default when the snapshot's init lacks the key", () => {
    row(field("wbmParam.HBV_Beta"));
    expect(screen.getByText(/In this snapshot: Not set/)).toBeTruthy();
    expect(screen.getByText(/WBM's default: 60/)).toBeTruthy();
  });

  it("says when it applies", () => {
    row(field("Spinup.Start"));
    expect(screen.getByText("Applies when loops > 0")).toBeTruthy();
  });

  it("has a Reset, and a mark, only when the draft changes it", () => {
    const { onReset } = row(field("wbmParam.alpha"));
    expect(screen.queryByRole("button", { name: /Reset/ })).toBeNull();
    expect(screen.queryByText("Changed")).toBeNull();
    cleanup();
    const changed = row(field("wbmParam.alpha"), { "wbmParam.alpha": "7" });
    expect(screen.getByText("Changed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reset Soil moisture drying coefficient" }));
    expect(changed.onReset).toHaveBeenCalledTimes(1);
    expect(onReset).not.toHaveBeenCalled();
  });

  it("shows the backend's message and ties it to the control", () => {
    row(field("wbmParam.alpha"), { "wbmParam.alpha": "abc" }, "Enter a number.");
    const input = screen.getByLabelText("Soil moisture drying coefficient");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const message = screen.getByText("Enter a number.");
    expect(input.getAttribute("aria-describedby")).toContain(message.id);
  });
});

describe("a dataset field the draft can copy", () => {
  const precip = fakeParamField("MT_Precip.Primary", {
    type: "dataset",
    editable: false,
    forkable: true,
    current: "/wbm/data/climate/precip/merra2_prectotcorr_d.init",
  });
  const rowWith = (f: ParamField, extra: Partial<Parameters<typeof ParamFieldRow>[0]> = {}) =>
    render(
      <ParamFieldRow
        field={f}
        custom={null}
        datasetId="snap-1"
        onChange={vi.fn()}
        onReset={vi.fn()}
        onForkChange={vi.fn()}
        {...extra}
      />
    );

  it("has Edit dataset when the tree says it can be copied and it reads a data init", () => {
    rowWith(precip);
    expect(screen.getByRole("button", { name: "Edit dataset merra2_prectotcorr_d.init" })).toBeTruthy();
    // still read-only: its value is the snapshot's, the copy is what the draft edits
    expect(screen.getByText("Read-only")).toBeTruthy();
  });

  it("has none when the tree does not say, when it holds a constant, or without the snapshot to read the original of", () => {
    rowWith({ ...precip, forkable: false });
    expect(screen.queryByRole("button", { name: /Edit dataset/ })).toBeNull();
    cleanup();
    rowWith({ ...precip, current: "0.5" });
    expect(screen.queryByRole("button", { name: /Edit dataset/ })).toBeNull();
    cleanup();
    rowWith(precip, { datasetId: undefined });
    expect(screen.queryByRole("button", { name: /Edit dataset/ })).toBeNull();
    cleanup();
    rowWith(precip, { onForkChange: undefined });
    expect(screen.queryByRole("button", { name: /Edit dataset/ })).toBeNull();
  });

  it("is marked changed, with a Reset, when it has a copy", () => {
    const onReset = vi.fn();
    rowWith(precip, { fork: { path: "MT_Precip.Primary", original: precip.current!, set: { Var_Scale: "2" } }, onReset });
    expect(screen.getByText("Changed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: `Reset ${precip.label}` }));
    expect(onReset).toHaveBeenCalled();
  });
});
