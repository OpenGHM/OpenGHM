import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { RegisterForm, registrationError } from "./register-form";

const fetchMock = vi.fn();

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function fillValid() {
  fill("Full name", "Ada Lovelace");
  fill("Email", "ada@purdue.edu");
  fill("Password", "long-enough-1");
  fill("Confirm password", "long-enough-1");
}

describe("the register form", () => {
  it("states the password rule as helper text, not only a placeholder", () => {
    render(<RegisterForm siteKey="" />);
    expect(screen.getByText("At least 8 characters.")).toBeTruthy();
    expect(screen.getByLabelText("Password").getAttribute("aria-describedby")).toBe("password-help");
  });

  it("shows a mismatch under the confirm field once it has been left, and clears it when they match", () => {
    render(<RegisterForm siteKey="" />);
    fill("Password", "long-enough-1");
    fill("Confirm password", "long-enough");
    expect(screen.queryByText("Passwords do not match.")).toBeNull();
    fireEvent.blur(screen.getByLabelText("Confirm password"));
    expect(screen.getByText("Passwords do not match.")).toBeTruthy();
    fill("Confirm password", "long-enough-1");
    expect(screen.queryByText("Passwords do not match.")).toBeNull();
  });

  it("shows the backend's reason for a refusal, not a generic line", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ detail: "reCAPTCHA verification failed. Please try again." }),
    });
    render(<RegisterForm siteKey="" />);
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("reCAPTCHA verification failed. Please try again.")
    );
  });
});

describe("registrationError", () => {
  it("passes a string detail through", () => {
    expect(registrationError(400, { detail: "reCAPTCHA verification failed. Please try again." })).toBe(
      "reCAPTCHA verification failed. Please try again."
    );
  });

  it("names the field of each 422 item", () => {
    expect(
      registrationError(422, {
        detail: [
          { loc: ["body", "email"], msg: "value is not a valid email address" },
          { loc: ["body", "name"], msg: "Field required" },
        ],
      })
    ).toBe("Email: value is not a valid email address Name: Field required");
  });

  it("words the backend's password rule as a sentence about the Password field", () => {
    expect(
      registrationError(422, {
        detail: [{ loc: ["body", "password"], msg: "must be at least 8 characters" }],
      })
    ).toBe("Password: must be at least 8 characters");
  });

  it("says the server could not be reached for a 502", () => {
    expect(registrationError(502, { detail: "Backend unreachable" })).toBe(
      "Unable to connect to the server. Please try again."
    );
  });

  it("falls back to a line with the status when there is no usable detail", () => {
    expect(registrationError(500, null)).toBe("Registration failed (error 500). Please try again.");
  });
});
