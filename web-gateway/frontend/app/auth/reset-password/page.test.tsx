import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { params } = vi.hoisted(() => ({ params: { value: "" } }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(params.value),
  useRouter: () => ({ push: vi.fn() }),
}));

import Page from "./page";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("/auth/reset-password", () => {
  it("resets a password by default", () => {
    params.value = "token=abc";
    render(<Page />);
    expect(screen.getByLabelText("New password")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset password" })).toBeTruthy();
    expect(screen.queryByText(/signs in without a password/)).toBeNull();
  });

  it("words itself as setting a password for an account that has none", () => {
    params.value = "token=abc&set=1";
    render(<Page />);
    expect(screen.getByText(/Your account signs in without a password/)).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Set password" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reset password" })).toBeNull();
  });

  async function submit(status: number, body: unknown) {
    params.value = "token=abc";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status, json: async () => body }));
    render(<Page />);
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "long-enough-1" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "long-enough-1" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
    });
  }

  it("shows the backend's rule when it refuses the password itself", async () => {
    await submit(422, {
      detail: [{ loc: ["body", "new_password"], msg: "must be at least 8 characters" }],
    });
    await waitFor(() =>
      expect(screen.getByText("Password: must be at least 8 characters.")).toBeTruthy()
    );
  });

  it("blames the link for any other refusal", async () => {
    await submit(400, { detail: "Invalid or expired reset token" });
    await waitFor(() => expect(screen.getByText(/invalid or has expired/)).toBeTruthy());
  });
});
