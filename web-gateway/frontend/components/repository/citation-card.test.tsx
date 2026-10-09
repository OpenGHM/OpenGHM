import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CitationCard } from "@/components/repository/citation-card";
import { fakeDataset } from "@/lib/workspace/fixtures";

beforeEach(() => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});
afterEach(cleanup);

describe("CitationCard", () => {
  const dataset = fakeDataset();

  it("opens on APA, switches to BibTeX, and copies what it shows", async () => {
    const { container } = render(<CitationCard dataset={dataset} />);

    expect(screen.getByRole("button", { name: "APA" }).getAttribute("aria-pressed")).toBe("true");
    const apa = container.querySelector("pre")!.textContent!;
    expect(apa).toContain(dataset.about.name);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(apa);
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "BibTeX" }));
    expect(screen.getByRole("button", { name: "BibTeX" }).getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector("pre")!.textContent).toMatch(/^@dataset\{/);
  });
});
