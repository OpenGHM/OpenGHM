import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const { params } = vi.hoisted(() => ({ params: { value: "" } }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(params.value),
}));

import Page from "./page";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("/auth/verify-email", () => {
  it("shows the error on the first render when there is no token, and sends nothing", () => {
    params.value = "";
    render(<Page />);
    expect(screen.getByText(/This verification link is invalid or has expired/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends nothing until the button is pressed, so a link scanner that only loads the page spends nothing", () => {
    params.value = "token=abc";
    render(<Page />);
    expect(screen.getByRole("button", { name: "Verify my email" })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the token once on the press and shows success", async () => {
    params.value = "token=abc";
    fetchMock.mockResolvedValue({ ok: true });
    render(<Page />);
    const button = screen.getByRole("button", { name: "Verify my email" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(screen.getByText(/Verifying your email/)).toBeTruthy();
    expect(await screen.findByText(/Your email has been verified/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/public-auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "abc" }),
    });
  });

  it("shows the error when the server rejects the token", async () => {
    params.value = "token=abc";
    fetchMock.mockResolvedValue({ ok: false });
    render(<Page />);
    fireEvent.click(screen.getByRole("button", { name: "Verify my email" }));
    expect(await screen.findByText(/This verification link is invalid or has expired/)).toBeTruthy();
  });

  it("shows the error when the request fails", async () => {
    params.value = "token=abc";
    fetchMock.mockRejectedValue(new Error("offline"));
    render(<Page />);
    fireEvent.click(screen.getByRole("button", { name: "Verify my email" }));
    expect(await screen.findByText(/This verification link is invalid or has expired/)).toBeTruthy();
  });
});
