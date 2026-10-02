import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useDelayedFlag } from "./use-delayed-flag";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useDelayedFlag", () => {
  it("is false while the flag is false", () => {
    const { result } = renderHook(() => useDelayedFlag(false));
    expect(result.current).toBe(false);
    act(() => void vi.advanceTimersByTime(1000));
    expect(result.current).toBe(false);
  });

  it("turns true only after the flag has been true for the delay", () => {
    const { result } = renderHook(() => useDelayedFlag(true, 300));
    expect(result.current).toBe(false);
    act(() => void vi.advanceTimersByTime(299));
    expect(result.current).toBe(false);
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current).toBe(true);
  });

  it("waits 300 ms unless told otherwise", () => {
    const { result } = renderHook(() => useDelayedFlag(true));
    act(() => void vi.advanceTimersByTime(299));
    expect(result.current).toBe(false);
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current).toBe(true);
  });

  it("never turns true when the flag ends inside the delay", () => {
    const { result, rerender } = renderHook(({ flag }) => useDelayedFlag(flag, 300), {
      initialProps: { flag: true },
    });
    act(() => void vi.advanceTimersByTime(200));
    rerender({ flag: false });
    act(() => void vi.advanceTimersByTime(1000));
    expect(result.current).toBe(false);
  });

  it("resets at once when the flag turns false, and waits the full delay again", () => {
    const { result, rerender } = renderHook(({ flag }) => useDelayedFlag(flag, 300), {
      initialProps: { flag: true },
    });
    act(() => void vi.advanceTimersByTime(300));
    expect(result.current).toBe(true);

    rerender({ flag: false });
    expect(result.current).toBe(false);

    rerender({ flag: true });
    expect(result.current).toBe(false);
    act(() => void vi.advanceTimersByTime(299));
    expect(result.current).toBe(false);
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current).toBe(true);
  });
});
