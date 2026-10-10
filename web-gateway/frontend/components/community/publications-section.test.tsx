import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PublicationsSection } from "./publications-section";
import { publication } from "./community.fixtures";

const PUBS = [
  publication(),
  publication({ id: "p-2", year: 2025, type: "software", title: "OpenGHM Toolkit", authors: "OpenGHM Project", venue: "GitHub release", link_label: "Repo", link_url: "https://github.com/openghm", citation: "OpenGHM Project (2025). OpenGHM Toolkit [Software]." }),
  publication({ id: "p-3", year: 2024, type: "talk", title: "A talk", link_label: null, link_url: null }),
];

let writeText: ReturnType<typeof vi.fn>;
beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function row(title: string) {
  return screen.getByText(title).closest("li") as HTMLElement;
}

describe("PublicationsSection", () => {
  it("shows year, type pill, title, authors and venue for each publication", () => {
    render(<PublicationsSection publications={PUBS} />);
    const r = within(row("Water balance model (WBM) v.1.0.0"));
    expect(r.getByText("2022")).toBeTruthy();
    expect(r.getByText("Paper")).toBeTruthy();
    expect(r.getByText("Grogan, D. S., Zuidema, S.")).toBeTruthy();
    expect(r.getByText("Geoscientific Model Development, 15, 7287–7323")).toBeTruthy();
  });

  it("links to the publication in a new tab, labelled as the admin wrote it", () => {
    render(<PublicationsSection publications={PUBS} />);
    const a = within(row("Water balance model (WBM) v.1.0.0")).getByRole("link", { name: /DOI/ });
    expect(a.getAttribute("href")).toBe("https://doi.org/10.5194/gmd-15-7287-2022");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("has no link button when there is no link, and never one to an unsafe address", () => {
    render(<PublicationsSection publications={[...PUBS, publication({ id: "p-4", title: "Evil", link_url: "javascript:alert(1)" })]} />);
    expect(within(row("A talk")).queryByRole("link")).toBeNull();
    expect(within(row("Evil")).queryByRole("link")).toBeNull();
  });

  it("copies the admin's citation, or one built from the parts, and says Copied ✓ for a moment", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<PublicationsSection publications={PUBS} />);

    fireEvent.click(within(row("OpenGHM Toolkit")).getByRole("button", { name: /Cite/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("OpenGHM Project (2025). OpenGHM Toolkit [Software]."));
    expect(within(row("OpenGHM Toolkit")).getByRole("button").textContent).toBe("Copied ✓");
    // Only that row's button changed.
    expect(within(row("A talk")).getByRole("button").textContent).toBe("Cite");

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(within(row("OpenGHM Toolkit")).getByRole("button").textContent).toBe("Cite");

    fireEvent.click(within(row("A talk")).getByRole("button", { name: /Cite/ }));
    await waitFor(() =>
      expect(writeText).toHaveBeenLastCalledWith("Grogan, D. S., Zuidema, S. (2024). A talk. Geoscientific Model Development, 15, 7287–7323."),
    );
  });

  it("says so when the clipboard refuses", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    render(<PublicationsSection publications={PUBS} />);
    fireEvent.click(within(row("A talk")).getByRole("button", { name: /Cite/ }));
    await waitFor(() => expect(within(row("A talk")).getByRole("button").textContent).toBe("Copy failed"));
    expect(screen.getByRole("status").textContent).toBe("The citation could not be copied.");
  });

  it("filters by type and brings everything back with All", () => {
    render(<PublicationsSection publications={PUBS} />);
    const group = screen.getByRole("group", { name: "Filter publications by type" });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["All", "Paper", "Software", "Talk"]);

    fireEvent.click(within(group).getByRole("button", { name: "Software" }));
    expect(within(group).getByRole("button", { name: "Software" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("OpenGHM Toolkit")).toBeTruthy();

    fireEvent.click(within(group).getByRole("button", { name: "All" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("has no filter when every publication is of one type", () => {
    render(<PublicationsSection publications={[PUBS[0], publication({ id: "p-9", title: "Another paper" })]} />);
    expect(screen.queryByRole("group")).toBeNull();
  });
});
