import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CitationCard } from "@/components/repository/citation-card";
import { fakeDataset } from "@/lib/workspace/fixtures";

beforeEach(() => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});
afterEach(cleanup);

const PAGE = `${window.location.origin}/repository/${fakeDataset().id}`;

describe("CitationCard", () => {
  const dataset = fakeDataset();
  const withAbout = (about: Partial<typeof dataset.about>) => ({ ...dataset, about: { ...dataset.about, ...about } });

  it("opens on APA, switches to BibTeX, and copies what it shows", async () => {
    const { container } = render(<CitationCard dataset={dataset} path={`/repository/${dataset.id}`} />);

    expect(screen.getByRole("button", { name: "APA" }).getAttribute("aria-pressed")).toBe("true");
    const apa = container.querySelector("pre")!.textContent!;
    expect(apa).toContain(dataset.about.name);
    fireEvent.click(screen.getByRole("button", { name: "Copy APA citation" }));
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(apa);
    expect(await screen.findByText("Copied")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "BibTeX" }));
    expect(screen.getByRole("button", { name: "BibTeX" }).getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector("pre")!.textContent).toMatch(/^@dataset\{/);
  });

  it("ends with the snapshot's own page, and keeps the paper's DOI out of the citation", () => {
    const paper = { relation: "isDescribedBy", url: "https://example.org/paper", doi: "10.5194/gmd-15-7287-2022" };
    const { container } = render(
      <CitationCard dataset={withAbout({ relatedLink: [paper] })} path={`/repository/${dataset.id}`} />
    );
    const apa = container.querySelector("pre")!.textContent!;
    expect(apa.endsWith(PAGE)).toBe(true);
    expect(apa).not.toContain("10.5194");
    fireEvent.click(screen.getByRole("button", { name: "BibTeX" }));
    const bibtex = container.querySelector("pre")!.textContent!;
    expect(bibtex).toContain(`url       = {${PAGE}}`);
    expect(bibtex).not.toContain("doi");

    // The paper has a line of its own, linked.
    const link = screen.getByRole("link", { name: "doi:10.5194/gmd-15-7287-2022" });
    expect(link.getAttribute("href")).toBe("https://doi.org/10.5194/gmd-15-7287-2022");
    expect(link.parentElement!.textContent).toContain("Please also cite the primary publication");
  });

  it("has no publication line without a DOI", () => {
    render(<CitationCard dataset={dataset} path={`/repository/${dataset.id}`} />);
    expect(screen.queryByText(/primary publication/)).toBeNull();
  });

  it("starts with the title when there are no creators", () => {
    const { container } = render(<CitationCard dataset={withAbout({ creator: [] as unknown as typeof dataset.about.creator })} path={`/repository/${dataset.id}`} />);
    expect(container.querySelector("pre")!.textContent).toMatch(/^Fake Snapshot \[Dataset\]\. \(2026\)\. OpenGHM\./);
    fireEvent.click(screen.getByRole("button", { name: "BibTeX" }));
    expect(container.querySelector("pre")!.textContent).not.toContain("author");
  });
});
