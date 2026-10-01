import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CatalogueHeader } from "./catalogue-header";

afterEach(cleanup);

describe("CatalogueHeader", () => {
  it("has the eyebrow, the one h1 and the subtitle", () => {
    render(<CatalogueHeader />);
    expect(screen.getByRole("heading", { level: 1, name: "Data Repository" })).toBeTruthy();
    expect(screen.getByText("Repository").className).toContain("uppercase");
    expect(screen.getByText("Repository").className).toContain("font-mono");
    expect(screen.getByText("Model snapshots and inputs shared by the OpenGHM community")).toBeTruthy();
  });
});
