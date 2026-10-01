import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Footer } from "@/components/landing/footer";

afterEach(cleanup);

describe("the footer", () => {
  it("lays the columns out for a phone first and widens from there", () => {
    const { container } = render(<Footer />);
    const grid = container.querySelector("footer .grid");
    expect(grid?.className).toContain("grid-cols-2");
    expect(grid?.className).toContain("lg:grid-cols-[2fr_1fr_1fr_1fr]");
    // The brand block spans the full row on a phone, and is one column from lg.
    const brand = grid?.firstElementChild;
    expect(brand?.className).toContain("col-span-2");
    expect(brand?.className).toContain("lg:col-span-1");
  });

  it("lists the three link columns", () => {
    render(<Footer />);
    for (const title of ["Platform", "Community", "Legal"]) {
      expect(screen.getByRole("heading", { name: title })).toBeTruthy();
    }
  });
});
