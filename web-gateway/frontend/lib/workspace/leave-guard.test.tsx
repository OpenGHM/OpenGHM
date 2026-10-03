import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
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
    a.addEventListener("click", (e) => (found = leavingHref(e as MouseEvent, page)), { once: true });
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
    expect(result.current.target).toBe("/workspace");
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
    expect(result.current.target).toBe("/workspace");
    act(() => result.current.stay());
    expect(result.current.target).toBeNull();
  });
});
