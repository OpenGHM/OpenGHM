import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const { params } = vi.hoisted(() => ({ params: { value: "" } }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(params.value),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("next-auth/react", () => ({
  signIn: vi.fn(),
  getProviders: async () => ({ cilogon: {} }),
}));

import { SignInForm } from "./signin-form";

afterEach(() => {
  cleanup();
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
