import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { COPY_FAILED, COPY_FEEDBACK_MS, CopyButton } from "@/components/ui/copy-button";

const writeText = vi.fn();
const status = () => document.querySelector("[data-copy-status]")!;
beforeEach(() => {
  vi.useFakeTimers();
  writeText.mockReset().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("CopyButton", () => {
  it("copies, says Copied in the label and a live region, and goes back after one shared duration", async () => {
    render(<CopyButton text="hello" label="greeting" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy greeting" }));
    await act(async () => {});
    expect(writeText).toHaveBeenCalledWith("hello");
    expect(screen.getByRole("button").textContent).toBe("Copied");
    expect(status().textContent).toBe("Copied greeting");

    act(() => void vi.advanceTimersByTime(COPY_FEEDBACK_MS));
    expect(screen.getByRole("button").textContent).toBe("Copy");
    expect(status().textContent).toBe("");
  });

  it("says so when the browser refuses the clipboard", async () => {
    writeText.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    render(<CopyButton text="hello" label="greeting" />);
    fireEvent.click(screen.getByRole("button"));
    await act(async () => {});
    expect(screen.getByRole("button").textContent).toBe("Copy failed");
    expect(screen.getByRole("button").getAttribute("title")).toBe(COPY_FAILED);
    expect(status().textContent).toBe(COPY_FAILED);
  });

  it("says so when there is no clipboard at all (an insecure page)", async () => {
    Object.assign(navigator, { clipboard: undefined });
    render(<CopyButton text="hello" label="greeting" />);
    fireEvent.click(screen.getByRole("button"));
    await act(async () => {});
    expect(status().textContent).toBe(COPY_FAILED);
  });

  it("is named by its label alone when icon-only, with a tooltip", async () => {
    render(<CopyButton text="u" label="URL of a.nc" iconOnly idleTitle="Copy URL" />);
    const button = screen.getByRole("button", { name: "Copy URL of a.nc" });
    expect(button.textContent).toBe("");
    expect(button.getAttribute("title")).toBe("Copy URL");
    fireEvent.click(button);
    await act(async () => {});
    expect(button.getAttribute("title")).toBe("Copied");
  });
});
