import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { cleanup, render, screen } from "@testing-library/react";

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

describe("/auth/confirm-link", () => {
  it("shows the error on the first render when there is no token, and sends nothing", () => {
    params.value = "";
    render(<Page />);
    expect(screen.getByText(/This confirmation link is invalid or has expired/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the token once and shows success", async () => {
    params.value = "token=abc";
    fetchMock.mockResolvedValue({ ok: true });
    render(<Page />);
    expect(screen.getByText(/Confirming the link/)).toBeTruthy();
    expect(await screen.findByText(/Your sign-in methods have been linked/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/public-auth/confirm-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "abc" }),
    });
  });

  it("spends a one-time token only once under Strict Mode's double effect", async () => {
    params.value = "token=abc";
    fetchMock.mockResolvedValue({ ok: true });
    render(
      <StrictMode>
        <Page />
      </StrictMode>,
    );
    expect(await screen.findByText(/Your sign-in methods have been linked/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows the error when the server rejects the token", async () => {
    params.value = "token=abc";
    fetchMock.mockResolvedValue({ ok: false });
    render(<Page />);
    expect(await screen.findByText(/This confirmation link is invalid or has expired/)).toBeTruthy();
  });

  it("shows the error when the request fails", async () => {
    params.value = "token=abc";
    fetchMock.mockRejectedValue(new Error("offline"));
    render(<Page />);
    expect(await screen.findByText(/This confirmation link is invalid or has expired/)).toBeTruthy();
  });
});
