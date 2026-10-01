import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

const search = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/repository",
  useSearchParams: () => search,
}));

import { useUrlSyncedFilters } from "./use-url-filters";

afterEach(cleanup);

type F = { q: string; page: number };
type R = { items: string[] };

function setup(fetcher: (f: F) => Promise<R>, initialError?: boolean) {
  return renderHook(() =>
    useUrlSyncedFilters<F, R>({
      initialFilters: { q: "", page: 1 },
      initialResult: { items: ["a"] },
      emptyResult: { items: [] },
      parse: (p) => ({ q: p.get("q") ?? "", page: 1 }),
      serialize: (f) => new URLSearchParams(f.q ? { q: f.q } : {}),
      fetcher,
      debounceMs: 0,
      initialError,
    })
  );
}

describe("useUrlSyncedFilters error flag", () => {
  it("starts without an error and keeps the result", () => {
    const { result } = setup(vi.fn());
    expect(result.current.error).toBe(false);
    expect(result.current.result.items).toEqual(["a"]);
  });

  it("can start in the error state when the server render failed", () => {
    const { result } = setup(vi.fn(), true);
    expect(result.current.error).toBe(true);
  });

  it("flags a failed fetch, returns the empty result, and recovers on retry", async () => {
    const fetcher = vi
      .fn<(f: F) => Promise<R>>()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce({ items: ["b"] });
    const { result } = setup(fetcher);

    act(() => result.current.setFilters({ q: "x" }));
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.result.items).toEqual([]);

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.error).toBe(false));
    expect(result.current.result.items).toEqual(["b"]);
    expect(fetcher).toHaveBeenLastCalledWith({ q: "x", page: 1 });
  });
});
