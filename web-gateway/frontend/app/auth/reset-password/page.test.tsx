import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const { params } = vi.hoisted(() => ({ params: { value: "" } }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(params.value),
  useRouter: () => ({ push: vi.fn() }),
}));

import Page from "./page";

afterEach(() => {
  cleanup();
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
});
