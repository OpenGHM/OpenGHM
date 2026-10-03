import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { FakeNavigation } from "@/lib/workspace/fake-navigation";
import { leavingHref, useLeaveGuard } from "@/lib/workspace/leave-guard";

const ORIGIN = window.location.origin;
const OWN = "/workspace/new/snap-1";
const page = { origin: ORIGIN, ownPath: OWN };

/** A link in the document, and a plain left click on it (or on what is inside it). */
function link(href: string, attrs: Record<string, string> = {}) {
  const a = document.createElement("a");
  a.setAttribute("href", href);
  for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v);
  const inner = document.createElement("span");
  inner.textContent = "x";
  a.append(inner);
  document.body.append(a);
  return { a, inner };
}
const click = (target: Element, init: MouseEventInit = {}) => {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
};

beforeEach(() => {
  window.history.replaceState(null, "", OWN + "?step=run");
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("leavingHref", () => {
  const hrefOf = (a: Element, init: MouseEventInit = {}) => {
    let found: string | null | undefined;
    a.addEventListener(
      "click",
      (e) => {
        found = leavingHref(e as MouseEvent, page);
        // jsdom would follow the link, and a fragment one fires `popstate` later.
        e.preventDefault();
      },
      { once: true }
    );
    click(a, init);
    return found;
  };

  it("is the path, query and hash of a same-origin link", () => {
    const { inner } = link("/workspace?status=FAILED#top");
    expect(hrefOf(inner)).toBe("/workspace?status=FAILED#top");
  });

  it("reads an absolute link to this origin the same way", () => {
    const { a } = link(`${ORIGIN}/repository`);
    expect(hrefOf(a)).toBe("/repository");
  });

  it("leaves the wizard's own links alone, whatever their query: the steps", () => {
    expect(hrefOf(link(`${OWN}?step=review`).a)).toBeNull();
    expect(hrefOf(link(`${OWN}?step=run`).a)).toBeNull();
    expect(hrefOf(link("#heading").a)).toBeNull();
  });

  it("is not fooled by a path that only starts like the wizard's", () => {
    expect(hrefOf(link("/workspace/new/snap-10?step=run").a)).toBe("/workspace/new/snap-10?step=run");
    expect(hrefOf(link("/workspace/new").a)).toBe("/workspace/new");
  });

  it("leaves other origins to the browser's own prompt", () => {
    expect(hrefOf(link("https://example.org/x").a)).toBeNull();
  });

  it("leaves modified and non-primary clicks, and links that open elsewhere or download", () => {
    const { a } = link("/workspace");
    for (const init of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { button: 2 }]) {
      expect(hrefOf(a, init)).toBeNull();
    }
    expect(hrefOf(link("/workspace", { target: "_blank" }).a)).toBeNull();
    expect(hrefOf(link("/files/x.csv", { download: "" }).a)).toBeNull();
    expect(hrefOf(link("/workspace", { target: "_self" }).a)).toBe("/workspace");
  });

  it("is null for a click that is not on a link, and for one already taken", () => {
    const div = document.createElement("div");
    document.body.append(div);
    expect(hrefOf(div)).toBeNull();
    const { a } = link("/workspace");
    let found: string | null | undefined;
    // Taken by someone earlier on the way down (capture), as the guard itself would.
    document.addEventListener("click", (e) => e.preventDefault(), { once: true, capture: true });
    a.addEventListener("click", (e) => (found = leavingHref(e as MouseEvent, page)), { once: true });
    click(a);
    expect(found).toBeNull();
  });
});

describe("useLeaveGuard", () => {
  it("while active, holds back a click on an in-app link and reports where it went", () => {
    const { result } = renderHook(() => useLeaveGuard({ active: true, ownPath: OWN }));
    const { inner } = link("/workspace");
    const event = click(inner);
    expect(event.defaultPrevented).toBe(true);
    expect(result.current.target).toEqual({ kind: "link", href: "/workspace" });
  });

  it("holds the click back before anything the link's own handler would do", () => {
    renderHook(() => useLeaveGuard({ active: true, ownPath: OWN }));
    const { a } = link("/workspace");
    let reached = false;
    a.addEventListener("click", () => (reached = true));
    click(a);
    expect(reached).toBe(false);
  });

  it("lets the wizard's own step links through, so changing step is never asked about", () => {
    const { result } = renderHook(() => useLeaveGuard({ active: true, ownPath: OWN }));
    const { a } = link(`${OWN}?step=review`);
    expect(click(a).defaultPrevented).toBe(false);
    expect(result.current.target).toBeNull();
  });

  it("does nothing while inactive: no click is held back and the browser is not asked", () => {
    const { result } = renderHook(() => useLeaveGuard({ active: false, ownPath: OWN }));
    const { a } = link("/workspace");
    expect(click(a).defaultPrevented).toBe(false);
    expect(result.current.target).toBeNull();
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
  });

  it("asks the browser before the page unloads, only while active", () => {
    const { rerender } = renderHook(({ active }) => useLeaveGuard({ active, ownPath: OWN }), {
      initialProps: { active: true },
    });
    const on = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(on);
    expect(on.defaultPrevented).toBe(true);

    rerender({ active: false });
    const off = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(off);
    expect(off.defaultPrevented).toBe(false);
  });

  it("stops holding clicks back once it goes inactive, as when a save is under way", () => {
    const { rerender } = renderHook(({ active }) => useLeaveGuard({ active, ownPath: OWN }), {
      initialProps: { active: true },
    });
    rerender({ active: false });
    const { a } = link("/workspace");
    expect(click(a).defaultPrevented).toBe(false);
  });

  it("forgets the link when asked to stay", () => {
    const { result } = renderHook(() => useLeaveGuard({ active: true, ownPath: OWN }));
    click(link("/workspace").a);
    expect(result.current.target).toEqual({ kind: "link", href: "/workspace" });
    act(() => result.current.stay());
    expect(result.current.target).toBeNull();
  });
});

describe("useLeaveGuard, the browser's Back and Forward", () => {
  const BEFORE = "/workspace";
  const AFTER = "/repository";
  const RUN = `${OWN}?step=run`;
  const REVIEW = `${OWN}?step=review`;

  let nav: FakeNavigation;
  /** Stands in for Next's own `popstate` listener, which is there from the start. */
  let next: ReturnType<typeof vi.fn>;
  const settle = () => act(async () => {});
  const press = async (delta: number) => {
    await act(async () => nav.go(delta));
    await settle();
  };
  const path = () => window.location.pathname + window.location.search;

  beforeEach(() => {
    next = vi.fn();
    window.addEventListener("popstate", next);
  });
  afterEach(() => {
    window.removeEventListener("popstate", next);
    nav?.uninstall();
  });

  it("cancels a Back that leaves the page: the address stays, Next never hears of it, nothing is added", async () => {
    nav = new FakeNavigation([BEFORE, RUN]);
    const { result } = renderHook(() => useLeaveGuard({ active: true, ownPath: OWN }));

    await press(-1);

    expect(result.current.target).toEqual({ kind: "history", key: nav.keyAt(0) });
    expect(nav.cancelled).toBe(1);
    expect(nav.index).toBe(1);
    expect(path()).toBe(RUN);
    expect(next).not.toHaveBeenCalled();
    expect(nav.entries).toHaveLength(2);
  });

  it("cancels a Forward that leaves the page just the same", async () => {
    nav = new FakeNavigation([BEFORE, RUN, AFTER], 1);
    const { result } = renderHook(() => useLeaveGuard({ active: true, ownPath: OWN }));
    await press(1);
    expect(result.current.target).toEqual({ kind: "history", key: nav.keyAt(2) });
    expect(nav.index).toBe(1);
    expect(next).not.toHaveBeenCalled();
  });

  it("names the entry a jump of several steps was heading for", async () => {
    nav = new FakeNavigation([BEFORE, AFTER, RUN]);
    const { result } = renderHook(() => useLeaveGuard({ active: true, ownPath: OWN }));
    await press(-2);
    expect(result.current.target).toEqual({ kind: "history", key: nav.keyAt(0) });
    expect(nav.index).toBe(2);
  });

  it("leaves a move between the page's own entries alone: the steps never ask", async () => {
    nav = new FakeNavigation([BEFORE, RUN]);
    const { result } = renderHook(() => useLeaveGuard({ active: true, ownPath: OWN }));
    // The page pushes its own step, as the wizard does.
    act(() => window.history.pushState(null, "", REVIEW));
    expect(nav.index).toBe(2);

    await press(-1);
    expect(path()).toBe(RUN);
    expect(result.current.target).toBeNull();
    expect(next).toHaveBeenCalledTimes(1);

    await press(1);
    expect(path()).toBe(REVIEW);
    expect(result.current.target).toBeNull();
    expect(next).toHaveBeenCalledTimes(2);
    expect(nav.cancelled).toBe(0);
  });

  it("holds the move out of the steps, after steps were taken", async () => {
    nav = new FakeNavigation([BEFORE, RUN]);
    const { result } = renderHook(() => useLeaveGuard({ active: true, ownPath: OWN }));
    act(() => window.history.pushState(null, "", REVIEW));
    await press(-1);
    await press(-1);
    expect(result.current.target).toEqual({ kind: "history", key: nav.keyAt(0) });
    expect(path()).toBe(RUN);
    expect(nav.index).toBe(1);
  });

  it("asks again for the next Back after Keep editing, even a second one in a row", async () => {
    nav = new FakeNavigation([BEFORE, RUN]);
    const { result } = renderHook(() => useLeaveGuard({ active: true, ownPath: OWN }));
    await press(-1);
    await press(-1);
    expect(nav.cancelled).toBe(2);
    act(() => result.current.stay());
    expect(result.current.target).toBeNull();
    expect(path()).toBe(RUN);

    await press(-1);
    expect(result.current.target).toEqual({ kind: "history", key: nav.keyAt(0) });
    expect(next).not.toHaveBeenCalled();
  });

  it("proceeds to the entry that was asked for, and Next takes that move", async () => {
    nav = new FakeNavigation([BEFORE, RUN]);
    const push = vi.fn();
    const { result } = renderHook(() => useLeaveGuard({ active: true, ownPath: OWN }));
    await press(-1);
    const held = result.current.target!;

    await act(async () => result.current.proceed(held, push));
    await settle();

    expect(nav.index).toBe(0);
    expect(path()).toBe(BEFORE);
    expect(next).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  it("proceeds without asking again, and without the browser's prompt on top, before it has switched off", async () => {
    nav = new FakeNavigation([BEFORE, RUN]);
    const { result } = renderHook(() => useLeaveGuard({ active: true, ownPath: OWN }));
    await press(-1);
    const cancelled = nav.cancelled;
    await act(async () => result.current.proceed(result.current.target!, vi.fn()));
    await settle();
    expect(nav.cancelled).toBe(cancelled);
    expect(nav.index).toBe(0);
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
  });

  it("proceeds with a held link by pushing it", () => {
    nav = new FakeNavigation([BEFORE, RUN]);
    const push = vi.fn();
    const { result } = renderHook(() => useLeaveGuard({ active: true, ownPath: OWN }));
    click(link("/workspace").a);
    act(() => result.current.proceed(result.current.target!, push));
    expect(push).toHaveBeenCalledWith("/workspace");
    expect(nav.index).toBe(1);
  });

  it("does nothing while inactive: the history behaves as it always did", async () => {
    nav = new FakeNavigation([BEFORE, RUN]);
    const { result, rerender } = renderHook(({ active }) => useLeaveGuard({ active, ownPath: OWN }), {
      initialProps: { active: false },
    });
    await press(-1);
    expect(result.current.target).toBeNull();
    expect(path()).toBe(BEFORE);
    expect(next).toHaveBeenCalledTimes(1);

    // Active, then off again (saved): back to leaving freely.
    await press(1);
    rerender({ active: true });
    rerender({ active: false });
    await press(-1);
    expect(path()).toBe(BEFORE);
    expect(next).toHaveBeenCalledTimes(3);
    expect(nav.cancelled).toBe(0);
  });

  it("holds from the moment it becomes active, wherever the page's own entries are then", async () => {
    nav = new FakeNavigation([BEFORE, RUN]);
    const { result, rerender } = renderHook(({ active }) => useLeaveGuard({ active, ownPath: OWN }), {
      initialProps: { active: false },
    });
    act(() => window.history.pushState(null, "", REVIEW));
    rerender({ active: true });
    await press(-1); // review to run: the page's own
    expect(result.current.target).toBeNull();
    await press(-1); // run to before: leaving
    expect(result.current.target).toEqual({ kind: "history", key: nav.keyAt(0) });
    expect(nav.index).toBe(1);
  });

  it("lets a move through that the browser does not let it cancel, and does not fight it", async () => {
    nav = new FakeNavigation([BEFORE, RUN]);
    nav.cancelable = false;
    const { result } = renderHook(() => useLeaveGuard({ active: true, ownPath: OWN }));
    await press(-1);
    expect(result.current.target).toBeNull();
    expect(path()).toBe(BEFORE);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("leaves navigations that are not traversals alone: a push or a replace elsewhere is not Back", () => {
    nav = new FakeNavigation([BEFORE, RUN]);
    renderHook(() => useLeaveGuard({ active: true, ownPath: OWN }));
    for (const navigationType of ["push", "replace", "reload"]) {
      const event = new Event("navigate", { cancelable: true });
      Object.assign(event, { navigationType, destination: { key: null, url: new URL(AFTER, window.location.href).href } });
      nav.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
  });

  it("does not hold back without the Navigation API, which is what a browser without it gets", async () => {
    nav = new FakeNavigation([BEFORE, RUN]);
    delete (window as unknown as { navigation?: unknown }).navigation;
    const { result } = renderHook(() => useLeaveGuard({ active: true, ownPath: OWN }));
    await press(-1);
    expect(result.current.target).toBeNull();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("holds again after a move it let through failed, instead of staying lifted", async () => {
    nav = new FakeNavigation([BEFORE, RUN]);
    const { result } = renderHook(() => useLeaveGuard({ active: true, ownPath: OWN }));
    await press(-1);
    vi.spyOn(nav, "traverseTo").mockImplementation(() => {
      throw new DOMException("gone", "InvalidStateError");
    });
    await act(async () => result.current.proceed(result.current.target!, vi.fn()));
    act(() => result.current.stay());
    await press(-1);
    expect(result.current.target).not.toBeNull();
    expect(nav.index).toBe(1);
  });

  it("stops listening when the page goes away", async () => {
    nav = new FakeNavigation([BEFORE, RUN]);
    const { unmount } = renderHook(() => useLeaveGuard({ active: true, ownPath: OWN }));
    unmount();
    await press(-1);
    expect(next).toHaveBeenCalledTimes(1);
    expect(nav.cancelled).toBe(0);
  });
});
