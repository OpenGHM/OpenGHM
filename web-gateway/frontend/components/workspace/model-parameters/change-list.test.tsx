import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ChangeList } from "@/components/workspace/model-parameters/change-list";
import type { ChangedEntry } from "@/lib/workspace/model-parameters";

afterEach(cleanup);

const items = () => screen.getAllByRole("listitem").map((li) => li.textContent);

describe("ChangeList", () => {
  it("shows a change as label, key = value, and the readable value only where it differs", () => {
    const changes: ChangedEntry[] = [
      { kind: "change", path: "wbmParam.maxRffStorage", label: "Runoff storage limit", value: "500", shown: "500 mm" },
      { kind: "change", path: "wbmParam.Infiltration", label: "Infiltration method", value: "HBV", shown: "HBV" },
      { kind: "change", path: "Glaciers", label: "Runoff from Glaciated Areas", value: "", shown: "switched off" },
    ];
    render(<ChangeList changes={changes} />);
    expect(items()).toEqual([
      "Runoff storage limitwbmParam.maxRffStorage = 500 · 500 mm",
      "Infiltration methodwbmParam.Infiltration = HBV",
      "Runoff from Glaciated AreasGlaciers = '' · switched off",
    ]);
  });

  it("shows a module switched on and a copy by their key and what was done, with no value of their own", () => {
    const changes: ChangedEntry[] = [
      { kind: "switched_on", path: "Glaciers", label: "Runoff from Glaciated Areas", value: "", shown: "switched on" },
      {
        kind: "fork",
        path: "MT_Precip.Primary",
        label: "Primary dataset",
        value: "/wbm/data/climate/precip/merra2_prectotcorr_d.init",
        shown: "copy of merra2_prectotcorr_d.init, Var_Scale 95040",
      },
    ];
    render(<ChangeList changes={changes} />);
    expect(items()).toEqual([
      "Runoff from Glaciated AreasGlaciers · switched on",
      "Primary datasetMT_Precip.Primary · copy of merra2_prectotcorr_d.init, Var_Scale 95040",
    ]);
  });

  it("shows the key and the raw value alone while the tree is not there", () => {
    render(
      <ChangeList changes={[{ kind: "change", path: "wbmParam.Infiltration", label: null, value: "HBV", shown: "HBV" }]} />
    );
    expect(items()).toEqual(["wbmParam.Infiltration = HBV"]);
  });
});
