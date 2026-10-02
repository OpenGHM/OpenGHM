import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

const search = new URLSearchParams();
const push = vi.fn();
const pushState = vi.spyOn(window.history, "pushState").mockImplementation(() => {});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => "/repository",
  useSearchParams: () => search,
}));

import { useUrlSyncedFilters } from "./use-url-filters";

afterEach(() => {
  cleanup();
  push.mockClear();
  pushState.mockClear();
});

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

describe("useUrlSyncedFilters inert keys", () => {
  type V = { q: string; view: string; page: number };
  const INERT = ["view"] as const;

  function setupView(fetcher: (f: V) => Promise<R>) {
    return renderHook(() =>
      useUrlSyncedFilters<V, R>({
        initialFilters: { q: "", view: "list", page: 1 },
        initialResult: { items: ["a"] },
        emptyResult: { items: [] },
        parse: (p) => ({ q: p.get("q") ?? "", view: p.get("view") ?? "list", page: 1 }),
        serialize: (f) => {
          const params = new URLSearchParams();
          if (f.q) params.set("q", f.q);
          if (f.view !== "list") params.set("view", f.view);
          if (f.page !== 1) params.set("page", String(f.page));
          return params;
        },
        fetcher,
        debounceMs: 0,
        inertKeys: INERT,
      })
    );
  }

  it("changes the URL but neither resets the page nor fetches again", async () => {
    const fetcher = vi.fn<(f: V) => Promise<R>>().mockResolvedValue({ items: ["b"] });
    const { result } = setupView(fetcher);

    act(() => result.current.setFilters({ page: 3 }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));

    act(() => result.current.setFilters({ view: "grid" }));
    await waitFor(() => expect(pushState).toHaveBeenLastCalledWith(null, "", "/repository?view=grid&page=3"));
    expect(result.current.filters.page).toBe(3);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("still resets the page and fetches for any other key", async () => {
    const fetcher = vi.fn<(f: V) => Promise<R>>().mockResolvedValue({ items: ["b"] });
    const { result } = setupView(fetcher);

    act(() => result.current.setFilters({ page: 3 }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    act(() => result.current.setFilters({ q: "x", view: "grid" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(result.current.filters.page).toBe(1);
    expect(fetcher).toHaveBeenLastCalledWith({ q: "x", view: "grid", page: 1 });
  });
});

describe("useUrlSyncedFilters history", () => {
  it("writes the URL with the native pushState, not router.push", async () => {
    const fetcher = vi.fn<(f: F) => Promise<R>>().mockResolvedValue({ items: ["b"] });
    const { result } = setup(fetcher);

    act(() => result.current.setFilters({ q: "x" }));
    await waitFor(() => expect(pushState).toHaveBeenCalledWith(null, "", "/repository?q=x"));
    expect(push).not.toHaveBeenCalled();
  });

  it("does not push the URL the page is already at", async () => {
    window.history.replaceState(null, "", "/repository?q=x");
    const fetcher = vi.fn<(f: F) => Promise<R>>().mockResolvedValue({ items: ["b"] });
    const { result } = setup(fetcher);

    act(() => result.current.setFilters({ q: "x" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    expect(pushState).not.toHaveBeenCalled();
    window.history.replaceState(null, "", "/");
  });

  it("keeps the current results while a fetch is pending", async () => {
    let resolve!: (r: R) => void;
    const fetcher = vi.fn<(f: F) => Promise<R>>(() => new Promise<R>((r) => (resolve = r)));
    const { result } = setup(fetcher);

    act(() => result.current.setFilters({ q: "x" }));
    await waitFor(() => expect(result.current.isPending).toBe(true));
    expect(result.current.result.items).toEqual(["a"]);

    await act(async () => resolve({ items: ["b"] }));
    expect(result.current.isPending).toBe(false);
    expect(result.current.result.items).toEqual(["b"]);
  });
});
