import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ActionResult } from "@/lib/jobs/types";
import type { DatasetInit } from "@/lib/workspace/dataset-forks";

vi.mock("@/lib/repository/actions", () => ({ fetchDatasetInit: vi.fn() }));

import { fetchDatasetInit } from "@/lib/repository/actions";
import { DatasetForkPanel, isDataInit } from "@/components/workspace/model-parameters/dataset-fork-panel";
import { FORK_PRECIP_INIT } from "@/lib/workspace/fixtures";
import { forgetDatasetInits } from "@/lib/workspace/use-dataset-init";

const fetchMock = vi.mocked(fetchDatasetInit);
const INIT: DatasetInit = {
  path: FORK_PRECIP_INIT,
  name: "merra2_prectotcorr_d.init",
  Code_Name: "merra2_prectotcorr_d",
  Units: "mm/day",
  Var_Scale: "86400",
  Var_Offset: "0",
  Time_Series: "daily",
  Start_Date: "2000-01-01",
  End_Date: "2015-12-31",
};
const ok = (data: DatasetInit): ActionResult<DatasetInit> => ({ ok: true, data });

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(ok(INIT));
  forgetDatasetInits();
});
afterEach(cleanup);

function panel(props: Partial<Parameters<typeof DatasetForkPanel>[0]> = {}) {
  const onChange = vi.fn();
  const view = render(
    <DatasetForkPanel
      datasetId="snap-1"
      path="MT_Precip.Primary"
      original={FORK_PRECIP_INIT}
      fork={null}
      onChange={onChange}
      {...props}
    />
  );
  return { onChange, ...view };
}

describe("isDataInit", () => {
  it("is true for a data init under /wbm/data or /wbm/data_init, and for nothing else", () => {
    expect(isDataInit(FORK_PRECIP_INIT)).toBe(true);
    expect(isDataInit("/wbm/data_init/glaciers/x.init")).toBe(true);
    for (const no of ["", "0.5", "/wbm/data/x.tif", "/wbm/wbm_init/x.init", "x.init"]) expect(isDataInit(no), no).toBe(false);
  });
});

describe("the Edit dataset panel", () => {
  it("is a button until it is asked for, and reads nothing before", () => {
    panel();
    expect(screen.getByRole("button", { name: "Edit dataset merra2_prectotcorr_d.init" })).toBeTruthy();
    expect(screen.queryByLabelText("Var_Scale")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("opens with the three values, each with the original's beside it", async () => {
    panel();
    fireEvent.click(screen.getByRole("button", { name: /Edit dataset/ }));
    const group = screen.getByRole("group", { name: "Edit dataset merra2_prectotcorr_d.init" });
    expect(within(group).getByLabelText("Var_Scale")).toBeTruthy();
    expect(within(group).getByLabelText("Var_Offset")).toBeTruthy();
    expect(within(group).getByLabelText("Units")).toBeTruthy();
    await waitFor(() => expect(within(group).getByText("86400")).toBeTruthy());
    expect(within(group).getByText("mm/day")).toBeTruthy();
    expect(within(group).getByText("0")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("snap-1", FORK_PRECIP_INIT);
    // only the three values can be edited: nothing for the dates or the file
    expect(within(group).queryByLabelText(/Start_Date|File_Path|Code_Name/)).toBeNull();
    expect(group.textContent).toContain("The original in the model input is not changed");
  });

  it("reports a copy with what was typed, and none once every box is empty again", () => {
    const { onChange, rerender } = panel();
    fireEvent.click(screen.getByRole("button", { name: /Edit dataset/ }));
    fireEvent.change(screen.getByLabelText("Var_Scale"), { target: { value: "95040" } });
    expect(onChange).toHaveBeenLastCalledWith({ path: "MT_Precip.Primary", original: FORK_PRECIP_INIT, set: { Var_Scale: "95040" } });
    rerender(
      <DatasetForkPanel
        datasetId="snap-1"
        path="MT_Precip.Primary"
        original={FORK_PRECIP_INIT}
        fork={{ path: "MT_Precip.Primary", original: FORK_PRECIP_INIT, set: { Var_Scale: "95040" } }}
        onChange={onChange}
      />
    );
    fireEvent.change(screen.getByLabelText("Units"), { target: { value: "mm/day" } });
    expect(onChange).toHaveBeenLastCalledWith({
      path: "MT_Precip.Primary",
      original: FORK_PRECIP_INIT,
      set: { Var_Scale: "95040", Units: "mm/day" },
    });
    // the only box still set is emptied: nothing is left to copy
    fireEvent.change(screen.getByLabelText("Var_Scale"), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("drops the copy when the last value is emptied and Reset removes it", () => {
    const fork = { path: "MT_Precip.Primary", original: FORK_PRECIP_INIT, set: { Var_Scale: "2" } };
    const { onChange } = panel({ fork });
    // a draft that holds a copy shows the panel open
    expect(screen.getByLabelText("Var_Scale")).toHaveProperty("value", "2");
    fireEvent.change(screen.getByLabelText("Var_Scale"), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(null);
    fireEvent.click(screen.getByRole("button", { name: "Reset dataset merra2_prectotcorr_d.init" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("says a malformed number at its box as it is typed", () => {
    panel({ fork: { path: "MT_Precip.Primary", original: FORK_PRECIP_INIT, set: { Var_Scale: ".5" } } });
    expect(screen.getByLabelText("Var_Scale").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Use a number like 1.1 or 2e-3.")).toBeTruthy();
    expect(screen.getByLabelText("Units").getAttribute("aria-invalid")).toBeNull();
  });

  it("stays open when the backend refused the field, so the message is not hidden", () => {
    panel({ error: "Var_Scale must be a number like 1.1 or 2e-3." });
    expect(screen.getByLabelText("Var_Scale")).toBeTruthy();
  });

  it("closes again when nothing is set", () => {
    panel();
    fireEvent.click(screen.getByRole("button", { name: /Edit dataset/ }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByLabelText("Var_Scale")).toBeNull();
  });

  it("keeps a repair, which has nothing to reset, and says what it repairs", () => {
    const fork = { path: "Glaciers.glArea", original: FORK_PRECIP_INIT, set: { Var_Scale: "2" } };
    const { onChange } = panel({ path: "Glaciers.glArea", fork, repair: "Its Code_Name differs from its file name." });
    expect(screen.queryByRole("button", { name: /Reset dataset/ })).toBeNull();
    expect(screen.getByText(/Its Code_Name differs from its file name./)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Var_Scale"), { target: { value: "" } });
    // emptied: still a copy, which repairs
    expect(onChange).toHaveBeenLastCalledWith({ path: "Glaciers.glArea", original: FORK_PRECIP_INIT, set: {} });
  });

  it("still lets the values be set when the original cannot be read, and says so", async () => {
    fetchMock.mockResolvedValue({ ok: false, reason: "error", status: 503, code: "model_input_unavailable", message: "The model input could not be read right now." });
    panel({ fork: { path: "MT_Precip.Primary", original: FORK_PRECIP_INIT, set: { Var_Scale: "2" } } });
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("The model input could not be read right now."));
    expect(screen.getByRole("status").textContent).toContain("You can still set the values.");
    expect(screen.getByLabelText("Var_Scale")).toBeTruthy();
  });

  it("says when the model input does not have the dataset", async () => {
    fetchMock.mockResolvedValue({ ok: false, reason: "not_found" });
    panel({ fork: { path: "MT_Precip.Primary", original: FORK_PRECIP_INIT, set: { Var_Scale: "2" } } });
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("The model input does not have this dataset."));
  });
});
