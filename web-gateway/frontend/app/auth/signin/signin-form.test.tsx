import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { params } = vi.hoisted(() => ({ params: { value: "" } }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(params.value),
  useRouter: () => ({ push: vi.fn() }),
}));
const { signInMock } = vi.hoisted(() => ({ signInMock: vi.fn() }));
vi.mock("next-auth/react", () => ({
  signIn: signInMock,
  getProviders: async () => ({ cilogon: {} }),
}));

import { SignInForm } from "./signin-form";

afterEach(() => {
  cleanup();
  signInMock.mockReset();
});

function show(search: string) {
  params.value = search;
  render(<SignInForm devAccounts={[]} />);
}

describe("the sign-in page after a refused CILogon sign-in", () => {
  it("says nothing on a plain visit", () => {
    show("");
    expect(screen.queryByText(/CILogon sign-in didn't work/)).toBeNull();
    expect(screen.queryByText(/deactivated/)).toBeNull();
    expect(screen.queryByText(/different CILogon identity/)).toBeNull();
  });

  it("says the account is deactivated", () => {
    show("sso=deactivated");
    expect(screen.getByText("This account has been deactivated. Contact an administrator.")).toBeTruthy();
  });

  it("says the email's account is connected to a different identity, and to sign in with that one", () => {
    show("sso=conflict");
    expect(
      screen.getByText(
        "This email's OpenGHM account is connected to a different CILogon identity. Sign in with that one."
      )
    ).toBeTruthy();
  });

  it("gives the generic failure for sso=failed", () => {
    show("sso=failed");
    expect(
      screen.getByText("CILogon sign-in didn't work. Try again, or sign in with your email and password.")
    ).toBeTruthy();
  });

  it("gives the generic failure when NextAuth itself sends ?error=", () => {
    show("error=token_expired");
    expect(
      screen.getByText("CILogon sign-in didn't work. Try again, or sign in with your email and password.")
    ).toBeTruthy();
  });

  it("ignores a reason it does not know", () => {
    show("sso=whatever");
    expect(screen.queryByText(/CILogon sign-in didn't work/)).toBeNull();
  });
});

describe("the notices on the sign-in page", () => {
  it("says the password was changed", () => {
    show("passwordChanged=1");
    expect(screen.getByText("Your password was changed. Sign in with the new password.")).toBeTruthy();
  });

  it("says nothing about a changed password on a plain visit", () => {
    show("");
    expect(screen.queryByText(/password was changed/)).toBeNull();
  });

  it("tells a new account to verify its email before running simulations", () => {
    show("registered=1");
    expect(screen.getByText(/verify your email address .* before you run simulations/)).toBeTruthy();
  });
});

describe("a refused password sign-in", () => {
  async function submit(result: { error: string; code?: string }) {
    signInMock.mockResolvedValue(result);
    show("");
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@purdue.edu" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw-123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));
    return waitFor(() => screen.getByRole("alert"));
  }

  it("gives the same line for a wrong email and a wrong password", async () => {
    expect((await submit({ error: "CredentialsSignin", code: "credentials" })).textContent).toBe(
      "Invalid email or password."
    );
  });

  it("says a deactivated account is deactivated, and whom to contact", async () => {
    expect((await submit({ error: "CredentialsSignin", code: "deactivated" })).textContent).toBe(
      "This account is deactivated. Contact the OpenGHM team at info@openghm.org."
    );
  });

  it("says to wait when there were too many attempts", async () => {
    expect((await submit({ error: "CredentialsSignin", code: "rate_limited" })).textContent).toBe(
      "Too many attempts. Try again in a few minutes."
    );
  });
});
