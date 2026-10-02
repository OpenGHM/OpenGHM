import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// The mocks read these, as Next's hooks read the router: change them, rerender.
let pathname = "/workspace";
let search = new URLSearchParams();
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => search,
}));

import { NavigationProgress } from "./navigation-progress";

beforeEach(() => {
  vi.useFakeTimers();
  pathname = "/workspace";
  search = new URLSearchParams();
  window.history.replaceState(null, "", "/workspace");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

/** Renders the bar and a link, and gives back the link to click. */
function setup(attrs: Record<string, string> = {}, href = "/repository/abc") {
  const view = render(
    <>
      <NavigationProgress />
      <a href={href} {...attrs}>
        <span>go</span>
      </a>
    </>
  );
  return { ...view, link: screen.getByText("go").closest("a")! };
}

const bar = () => screen.queryByRole("progressbar");
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

/** A click that goes nowhere in jsdom, which would not navigate. */
function click(el: Element, init: MouseEventInit = {}) {
  fireEvent.click(el, { button: 0, ...init });
}

describe("NavigationProgress", () => {
  it("draws nothing at rest", () => {
    setup();
    expect(bar()).toBeNull();
  });

  it("appears only if the navigation is still pending after 200 ms", () => {
    const { link } = setup();
    click(link);
    advance(199);
    expect(bar()).toBeNull();
    advance(1);
    const progress = bar()!;
    expect(progress.getAttribute("aria-label")).toBe("Loading page");
    expect(progress.getAttribute("data-phase")).toBe("active");
    expect(progress.className).toContain("pointer-events-none");
    expect(progress.className).toContain("fixed");
    expect(progress.className).toContain("bg-primary");
  });

  it("never appears when the page arrives inside the delay", () => {
    const { link, rerender } = setup();
    click(link);
    advance(100);
    pathname = "/repository/abc";
    rerender(<NavigationProgress />);
    advance(1000);
    expect(bar()).toBeNull();
  });

  it("completes and goes when the pathname changes", () => {
    const { link, rerender } = setup();
    click(link);
    advance(200);
    expect(bar()!.getAttribute("data-phase")).toBe("active");

    pathname = "/repository/abc";
    rerender(<NavigationProgress />);
    expect(bar()!.getAttribute("data-phase")).toBe("completing");
    advance(400);
    expect(bar()).toBeNull();
  });

  it("completes when only the query changes", () => {
    const { link, rerender } = setup({}, "/workspace?status=FAILED");
    click(link);
    advance(200);

    search = new URLSearchParams("status=FAILED");
    rerender(<NavigationProgress />);
    expect(bar()!.getAttribute("data-phase")).toBe("completing");
  });

  it("gives up after 10 s, so it never sticks", () => {
    const { link } = setup();
    click(link);
    advance(200);
    advance(9_799);
    expect(bar()).not.toBeNull();
    advance(1);
    expect(bar()).toBeNull();
  });

  it.each([
    ["an external link", {}, "https://example.com/page"],
    ["a link that opens a new tab", { target: "_blank" }, "/repository/abc"],
    ["a download", { download: "" }, "/files/a.zip"],
    ["a hash on this page", {}, "/workspace#section"],
    ["a link to the page you are on", {}, "/workspace"],
    ["a mailto link", {}, "mailto:someone@example.com"],
  ] as const)("ignores %s", (_name, attrs, href) => {
    const { link } = setup({ ...attrs }, href);
    click(link);
    advance(1000);
    expect(bar()).toBeNull();
  });

  it.each([
    ["ctrl", { ctrlKey: true }],
    ["meta", { metaKey: true }],
    ["shift", { shiftKey: true }],
    ["alt", { altKey: true }],
    ["a middle click", { button: 1 }],
    ["a right click", { button: 2 }],
  ] as const)("ignores a click with %s", (_name, init) => {
    const { link } = setup();
    click(link, init);
    advance(1000);
    expect(bar()).toBeNull();
  });

  it("starts from a click on something inside the link", () => {
    setup();
    click(screen.getByText("go"));
    advance(200);
    expect(bar()).not.toBeNull();
  });

  it("starts for a click whose handler called preventDefault, as Next's Link does for every navigation", () => {
    const { link } = setup();
    link.addEventListener("click", (e) => e.preventDefault());
    click(link);
    advance(200);
    expect(bar()).not.toBeNull();
  });

  it("starts for a link a React handler cancels", () => {
    const href = "/repository/abc";
    render(
      <>
        <NavigationProgress />
        <a href={href} onClick={(e) => e.preventDefault()}>
          react link
        </a>
      </>
    );
    click(screen.getByText("react link"));
    advance(200);
    expect(bar()).not.toBeNull();
  });
});
