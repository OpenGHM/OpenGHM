import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { setGroupInterest, toast } = vi.hoisted(() => ({
  setGroupInterest: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/community/actions", () => ({ setGroupInterest }));
vi.mock("sonner", () => ({ toast }));

import { GroupInterestButton } from "./group-interest-button";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("GroupInterestButton", () => {
  it("is a link to sign in, returning to this page, for a visitor who is signed out", () => {
    render(<GroupInterestButton signedIn={false} interested={false} here="/community?tab=groups" />);
    const a = screen.getByRole("link", { name: "Notify me when groups open" });
    expect(a.getAttribute("href")).toBe("/auth/signin?callbackUrl=%2Fcommunity%3Ftab%3Dgroups");
    expect(screen.queryByRole("button")).toBeNull();
    expect(setGroupInterest).not.toHaveBeenCalled();
  });

  it("records the interest when a signed-in visitor presses it, and says we will email them", async () => {
    setGroupInterest.mockResolvedValue({ ok: true, data: { interested: true } });
    render(<GroupInterestButton signedIn interested={false} here="/community" />);
    fireEvent.click(screen.getByRole("button", { name: "Notify me when groups open" }));
    expect(screen.getByRole("button").textContent).toBe("We will email you ✓");
    await waitFor(() => expect(setGroupInterest).toHaveBeenCalledWith(true));
    expect(screen.getByRole("button").textContent).toBe("We will email you ✓");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("starts as 'We will email you ✓' when the visitor already asked, and withdraws on a second press", async () => {
    setGroupInterest.mockResolvedValue({ ok: true, data: { interested: false } });
    render(<GroupInterestButton signedIn interested here="/community" />);
    expect(screen.getByRole("button").textContent).toBe("We will email you ✓");
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(setGroupInterest).toHaveBeenCalledWith(false));
    await waitFor(() => expect(screen.getByRole("button").textContent).toBe("Notify me when groups open"));
  });

  it("goes back and says why when the call fails", async () => {
    setGroupInterest.mockResolvedValue({ ok: false, reason: "error", message: "The server hit a problem." });
    render(<GroupInterestButton signedIn interested={false} here="/community" />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("The server hit a problem."));
    await waitFor(() => expect(screen.getByRole("button").textContent).toBe("Notify me when groups open"));
  });

  it("asks to sign in again when the session is over", async () => {
    setGroupInterest.mockResolvedValue({ ok: false, reason: "session_expired" });
    render(<GroupInterestButton signedIn interested={false} here="/community" />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/session has expired/i)));
  });
});
