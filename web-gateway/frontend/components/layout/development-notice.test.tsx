import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DevelopmentNotice } from "@/components/layout/development-notice";

describe("DevelopmentNotice", () => {
  it("says the site is under development", () => {
    render(<DevelopmentNotice />);
    expect(screen.getByRole("note").textContent).toContain("This website is under development.");
  });
});
