import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { HeroTitle } from "./hero-title";
import { DatasetJsonLd } from "./dataset-json-ld";
import { fakeDataset } from "@/lib/workspace/fixtures";

afterEach(cleanup);

const FULL =
  "WBM v1.0.0 Wyoming_tracking simulation for 'Water balance model (WBM) v.1.0.0: a scalable gridded global hydrologic model': [Wyoming] [2000-2009]";

describe("HeroTitle", () => {
  it("makes the short name the page's heading and puts the full name beneath it, smaller", () => {
    render(<HeroTitle about={{ name: FULL, shortName: "WBM v1 Wyoming 2000–2009" }} />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe("WBM v1 Wyoming 2000–2009");
    const full = screen.getByText(FULL);
    expect(full.tagName).toBe("P");
    expect(full.className).toContain("text-sm");
    expect(h1.className).toContain("text-3xl");
    expect(screen.getByText("Full title:").className).toContain("sr-only");
  });

  it("is the one heading it has always been without a short name", () => {
    const { container } = render(<HeroTitle about={{ name: FULL }} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(FULL);
    expect(container.querySelectorAll("p")).toHaveLength(0);
  });

  it("does not say the same words twice when the short name is the name", () => {
    const { container } = render(<HeroTitle about={{ name: "Same", shortName: "Same" }} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Same");
    expect(container.querySelectorAll("p")).toHaveLength(0);
  });
});

describe("DatasetJsonLd", () => {
  const jsonLd = (dataset: ReturnType<typeof fakeDataset>) => {
    const { container } = render(<DatasetJsonLd dataset={dataset} />);
    return JSON.parse(container.querySelector("script")!.textContent!);
  };

  it("keeps the full name as the schema.org name and adds the short one as alternateName", () => {
    const base = fakeDataset();
    const ld = jsonLd({ ...base, about: { ...base.about, name: FULL, shortName: "WBM v1 Wyoming" } });
    expect(ld.name).toBe(FULL);
    expect(ld.alternateName).toBe("WBM v1 Wyoming");
  });

  it("has no alternateName without a short name", () => {
    const base = fakeDataset();
    expect(jsonLd({ ...base, about: { ...base.about, name: FULL } })).not.toHaveProperty("alternateName");
  });
});
