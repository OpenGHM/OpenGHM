import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ModelInput } from "@/lib/repository/types";

vi.mock("@/lib/repository/actions", () => ({ fetchModelInputById: vi.fn() }));

import { fetchModelInputById } from "@/lib/repository/actions";
import { fakeDataset } from "@/lib/workspace/fixtures";
import {
  effectiveModelInputId,
  useCatalogueModelInput,
} from "@/lib/workspace/use-catalogue-model-input";

const fetchMock = vi.mocked(fetchModelInputById);
const entry = { id: "mi-1", about: { name: "Network" } } as ModelInput;

beforeEach(() => {
  fetchMock.mockReset();
});
afterEach(cleanup);

describe("useCatalogueModelInput", () => {
  it("is undefined while looking, then the model input the catalogue holds", async () => {
    fetchMock.mockResolvedValue(entry);
    const { result } = renderHook(() => useCatalogueModelInput("mi-1"));
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current).toBe(entry));
    expect(fetchMock).toHaveBeenCalledWith("mi-1");
  });

  it("is null when the catalogue does not hold it", async () => {
    fetchMock.mockResolvedValue(null);
    const { result } = renderHook(() => useCatalogueModelInput("mi-1"));
    await waitFor(() => expect(result.current).toBeNull());
  });

  it("is null when the lookup fails", async () => {
    fetchMock.mockRejectedValue(new Error("down"));
    const { result } = renderHook(() => useCatalogueModelInput("mi-1"));
    await waitFor(() => expect(result.current).toBeNull());
  });

  it("is null at once for no id, and looks nothing up", () => {
    const { result } = renderHook(() => useCatalogueModelInput(null));
    expect(result.current).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads a different id as looking again, never as the old answer", async () => {
    fetchMock.mockResolvedValueOnce(entry).mockReturnValueOnce(new Promise(() => {}));
    const { result, rerender } = renderHook(({ id }) => useCatalogueModelInput(id), {
      initialProps: { id: "mi-1" },
    });
    await waitFor(() => expect(result.current).toBe(entry));
    rerender({ id: "mi-2" });
    expect(result.current).toBeUndefined();
  });
});

describe("effectiveModelInputId", () => {
  it("is the override, else the snapshot's own, else none", () => {
    const snapshot = fakeDataset();
    expect(effectiveModelInputId("mine", snapshot)).toBe("mine");
    expect(effectiveModelInputId(null, snapshot)).toBe("fake-model-input-id");
    expect(effectiveModelInputId(null, null)).toBeNull();
  });
});
