import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { cleanup, render, screen } from "@testing-library/react";
import { CurrentYear } from "@/components/landing/current-year";
import { Footer } from "@/components/landing/footer";

// `act` needs this in a test that drives react-dom directly.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("the current year", () => {
  it("shows the year at the time it is viewed", () => {
    vi.setSystemTime(new Date("2031-06-15T12:00:00Z"));
    render(<CurrentYear />);
    expect(screen.getByText("2031")).toBeTruthy();
  });

  it("is in the footer's copyright line", () => {
    vi.setSystemTime(new Date("2031-06-15T12:00:00Z"));
    const { container } = render(<Footer />);
    const line = container.querySelector("footer .border-t p");
    expect(line?.textContent).toMatch(/^© 2031 OpenGHM Project\./);
    expect(container.textContent).not.toContain("2025");
  });

  it("hydrates a page built in the same year without a warning", async () => {
    vi.setSystemTime(new Date("2031-06-15T12:00:00Z"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const container = document.createElement("div");
    container.innerHTML = renderToString(<CurrentYear />);
    document.body.append(container);

    await act(async () => {
      hydrateRoot(container, <CurrentYear />);
    });

    expect(container.textContent).toBe("2031");
    expect(error).not.toHaveBeenCalled();
  });

  it("corrects a page that was built in an earlier year, without a warning", async () => {
    vi.setSystemTime(new Date("2030-12-31T12:00:00Z"));
    const container = document.createElement("div");
    container.innerHTML = renderToString(<CurrentYear />);
    document.body.append(container);
    expect(container.textContent).toBe("2030");

    vi.setSystemTime(new Date("2031-01-02T12:00:00Z"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => {
      hydrateRoot(container, <CurrentYear />);
    });

    expect(container.textContent).toBe("2031");
    expect(error).not.toHaveBeenCalled();
  });
});
