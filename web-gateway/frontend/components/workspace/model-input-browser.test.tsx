import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ModelInput, ModelInputListResponse } from "@/lib/repository/types";

vi.mock("@/lib/repository/actions", () => ({ fetchModelInputs: vi.fn() }));

import { ModelInputBrowser } from "@/components/workspace/model-input-browser";
import { ModelInputMiniCard } from "@/components/workspace/model-input-mini-card";
import { UNSUPPORTED_REASON } from "@/lib/jobs/compute";
import { fetchModelInputs } from "@/lib/repository/actions";

const fetchMock = vi.mocked(fetchModelInputs);

const input = (id: string, name: string) =>
  ({
    id,
    about: { name, description: `${name} description`, tags: [] },
    datasets: [{}, {}],
    networks: [{}],
  }) as unknown as ModelInput;

const page = (items: ModelInput[], totalPages = 1, n = 1): ModelInputListResponse => ({
  items,
  totalCount: items.length,
  totalPages,
  page: n,
});

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Let the pending promise callbacks and the 300 ms pause run. */
const settle = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

describe("ModelInputBrowser", () => {
  it("is collapsed, fetches nothing, and says why a model input cannot be chosen", async () => {
    render(<ModelInputBrowser />);
    await settle(1000);
    expect(fetchMock).not.toHaveBeenCalled();
    const toggle = screen.getByRole("button", { name: "Browse model inputs" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText(UNSUPPORTED_REASON.modelInput)).toBeTruthy();
    expect(screen.queryByRole("searchbox")).toBeNull();
  });

  it("lists the catalogue when opened, with no way to choose one, and marks the one in use", async () => {
    fetchMock.mockResolvedValue(page([input("a", "Global"), input("b", "Regional")]));
    render(<ModelInputBrowser currentId="b" />);
    fireEvent.click(screen.getByRole("button", { name: "Browse model inputs" }));
    await settle();

    expect(fetchMock).toHaveBeenCalledWith({ searchQuery: "", sortBy: "relevance", page: 1 });
    expect(screen.getByText("Global")).toBeTruthy();
    expect(screen.getByText("Regional")).toBeTruthy();
    expect(screen.getByText("In use by this draft")).toBeTruthy();
    // Only the toggle is a button: the cards cannot be selected.
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Browse model inputs" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("asks again after a pause in typing, from the first page", async () => {
    fetchMock.mockResolvedValue(page([input("a", "Global")], 3));
    render(<ModelInputBrowser />);
    fireEvent.click(screen.getByRole("button", { name: "Browse model inputs" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await settle();
    expect(fetchMock).toHaveBeenLastCalledWith({ searchQuery: "", sortBy: "relevance", page: 2 });

    fireEvent.change(screen.getByRole("searchbox", { name: "Search model inputs" }), { target: { value: "reg" } });
    await settle(100);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await settle(300);
    expect(fetchMock).toHaveBeenLastCalledWith({ searchQuery: "reg", sortBy: "relevance", page: 1 });
  });

  it("pages through the catalogue", async () => {
    fetchMock.mockResolvedValue(page([input("a", "Global")], 2));
    render(<ModelInputBrowser />);
    fireEvent.click(screen.getByRole("button", { name: "Browse model inputs" }));
    await settle();
    expect(screen.getByText("Page 1 of 2")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Previous" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await settle();
    expect(screen.getByText("Page 2 of 2")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).toHaveBeenLastCalledWith({ searchQuery: "", sortBy: "relevance", page: 2 });
  });

  it("says nothing was found, also when the catalogue cannot be reached", async () => {
    fetchMock.mockRejectedValue(new Error("down"));
    render(<ModelInputBrowser />);
    fireEvent.click(screen.getByRole("button", { name: "Browse model inputs" }));
    await settle();
    expect(screen.getByText("No model inputs found.")).toBeTruthy();
  });
});

describe("ModelInputMiniCard", () => {
  it("is a button only when it can be selected", () => {
    const onSelect = vi.fn();
    const { rerender } = render(<ModelInputMiniCard modelInput={input("a", "Global")} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("2 datasets")).toBeTruthy();
    expect(screen.getByText("1 network")).toBeTruthy();

    rerender(<ModelInputMiniCard modelInput={input("a", "Global")} onSelect={onSelect} selected />);
    fireEvent.click(screen.getByRole("button"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Selected")).toBeTruthy();
  });
});
