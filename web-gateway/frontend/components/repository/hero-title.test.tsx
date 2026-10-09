import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { HeroTitle, heroTitleSize } from "@/components/repository/hero-title";

afterEach(cleanup);

const SHORT = "Global Storage Run";
const MEDIUM = "WBM v1.0.0 Global_tracking snapshot draft for 'Water balance model (WBM)': [Global] [2000-2009]";
const PAPER =
  "WBM v1.0.0 Wyoming_tracking simulation for 'Water balance model (WBM) v.1.0.0: a scalable gridded global hydrologic model with water-tracking functionality': [Wyoming] [2000-2009]";

describe("heroTitleSize", () => {
  it("keeps the size the page always had for a short name", () => {
    expect(heroTitleSize(SHORT)).toBe("text-2xl md:text-3xl");
    expect(heroTitleSize("x".repeat(89))).toBe("text-2xl md:text-3xl");
  });

  it("steps down at 90 characters", () => {
    expect(MEDIUM.length).toBeGreaterThanOrEqual(90);
    expect(MEDIUM.length).toBeLessThan(140);
    expect(heroTitleSize(MEDIUM)).toBe("text-xl md:text-2xl");
    expect(heroTitleSize("x".repeat(90))).toBe("text-xl md:text-2xl");
    expect(heroTitleSize("x".repeat(139))).toBe("text-xl md:text-2xl");
  });

  it("steps down again at 140 characters", () => {
    expect(PAPER.length).toBeGreaterThanOrEqual(140);
    expect(heroTitleSize(PAPER)).toBe("text-lg md:text-xl");
    expect(heroTitleSize("x".repeat(140))).toBe("text-lg md:text-xl");
  });

  it("counts the name without the spaces around it", () => {
    expect(heroTitleSize(`  ${"x".repeat(89)}  `)).toBe("text-2xl md:text-3xl");
  });
});

describe("HeroTitle", () => {
  it("is the page's h1 with the whole name, balanced, and no clamp", () => {
    render(<HeroTitle name={PAPER} />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe(PAPER);
    expect(h1.className).toContain("text-balance");
    expect(h1.className).not.toContain("line-clamp");
    expect(h1.className).not.toContain("truncate");
    expect(h1.className).toContain("text-lg");
    expect(h1.className).toContain("max-w-4xl");
  });

  it("looks as it did for a short name: the same size, no width cap", () => {
    render(<HeroTitle name={SHORT} />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.className).toContain("text-2xl");
    expect(h1.className).toContain("md:text-3xl");
    expect(h1.className).not.toContain("max-w-");
  });
});
