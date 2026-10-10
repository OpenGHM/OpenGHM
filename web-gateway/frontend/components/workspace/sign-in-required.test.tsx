import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// The band and the footer have their own tests; here they are stand-ins.
vi.mock("@/components/workspace/page-header", () => ({
  PageHeader: ({ eyebrow, title }: { eyebrow: string; title: string }) => (
    <header>
      <p>{eyebrow}</p>
      <h1>{title}</h1>
    </header>
  ),
}));
vi.mock("@/components/layout/page-hero", () => ({
  PageBody: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/components/landing/footer", () => ({ Footer: () => <footer>footer</footer> }));

import { SignInRequired } from "./sign-in-required";

afterEach(cleanup);

const href = (name: string) => screen.getByRole("link", { name }).getAttribute("href");

describe("SignInRequired, signed out", () => {
  it("has the band's one h1 and the card's h2", () => {
    render(<SignInRequired reason="none" here="/workspace" />);
    expect(screen.getByRole("heading", { level: 1, name: "Workspace" })).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 2, name: "Sign in to use the Workspace" })).toBeTruthy();
  });

  it("says what the Workspace is for, in the user's words", () => {
    render(<SignInRequired reason="none" here="/workspace" />);
    expect(screen.getByText(/run model snapshots with your own settings on Anvil/)).toBeTruthy();
    expect(screen.getByText(/keep your snapshot drafts/)).toBeTruthy();
  });

  it("links Sign in back to the same page, query included", () => {
    render(<SignInRequired reason="none" here="/workspace?status=FAILED&page=2" />);
    expect(href("Sign in")).toBe("/auth/signin?callbackUrl=%2Fworkspace%3Fstatus%3DFAILED%26page%3D2");
  });

  it("links Create an account to the register page, which takes no callback", () => {
    render(<SignInRequired reason="none" here="/workspace/new" />);
    expect(href("Create an account")).toBe("/auth/register");
  });

  it("offers the Data Repository, which needs no account", () => {
    render(<SignInRequired reason="none" here="/workspace" />);
    expect(href("Browse the Data Repository")).toBe("/repository");
  });

  it("renders the footer", () => {
    render(<SignInRequired reason="none" here="/workspace" />);
    expect(screen.getByText("footer")).toBeTruthy();
  });
});

describe("SignInRequired, session ended", () => {
  it("says the session ended and how to continue", () => {
    render(<SignInRequired reason="expired" here="/workspace/j1" />);
    expect(screen.getByRole("heading", { level: 2, name: "Your session has ended" })).toBeTruthy();
    expect(screen.getByText("Sign in again to continue where you left off.")).toBeTruthy();
  });

  it("links Sign in again back to the same page", () => {
    render(<SignInRequired reason="expired" here="/workspace/j1?step=run" />);
    expect(href("Sign in again")).toBe("/auth/signin?callbackUrl=%2Fworkspace%2Fj1%3Fstep%3Drun");
  });

  it("offers no other way out than signing in again", () => {
    render(<SignInRequired reason="expired" here="/workspace" />);
    expect(screen.queryByRole("link", { name: "Create an account" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Browse the Data Repository" })).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
});
