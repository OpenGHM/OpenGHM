import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MaterialsList, WorkshopDetails } from "./workshop-parts";
import { workshop } from "./community.fixtures";

afterEach(cleanup);

const FILE_ID = "65f1a2b3c4d5e6f708192a3b";

describe("MaterialsList", () => {
  const materials = [
    { name: "Slides", url: `/api/community/files/${FILE_ID}`, note: "PDF, 4 MB" },
    { name: "Slides.pdf", url: `/api/community/files/${FILE_ID}`, note: null },
    { name: "Notebook", url: "https://example.org/demo.ipynb", note: "Runs in Colab" },
    { name: "Recording", url: "https://example.org/recording", note: "Video of the session" },
  ];

  it("lists each material with its type tile, name and note, and the count", () => {
    render(<MaterialsList materials={materials} />);
    expect(screen.getByRole("heading", { name: "Materials" })).toBeTruthy();
    expect(screen.getByText("4 files")).toBeTruthy();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(4);
    expect(within(items[0]).getByText("Slides")).toBeTruthy();
    expect(within(items[0]).getByText("PDF, 4 MB")).toBeTruthy();
    expect(within(items[2]).getByText("IPYNB")).toBeTruthy();
    expect(within(items[2]).getByText("Runs in Colab")).toBeTruthy();
  });

  it("offers an uploaded file as Download ↓, from this site, to save", () => {
    render(<MaterialsList materials={materials} />);
    const a = screen.getAllByRole("listitem")[1].querySelector("a") as HTMLAnchorElement;
    expect(a.textContent).toContain("Download ↓");
    expect(a.getAttribute("href")).toBe(`/api/community/files/${FILE_ID}`);
    expect(a.hasAttribute("download")).toBe(true);
    expect(a.getAttribute("target")).toBeNull();
    expect(within(a).getByText("PDF")).toBeTruthy();
  });

  it("offers a file elsewhere on the web as Download ↓ in a new tab, and a plain link as Open ↗", () => {
    render(<MaterialsList materials={materials} />);
    const [, , notebook, recording] = screen.getAllByRole("listitem").map((li) => li.querySelector("a") as HTMLAnchorElement);
    expect(notebook.textContent).toContain("Download ↓");
    expect(notebook.getAttribute("target")).toBe("_blank");
    expect(notebook.getAttribute("rel")).toBe("noopener noreferrer");
    expect(recording.textContent).toContain("Open ↗");
    expect(recording.getAttribute("target")).toBe("_blank");
    expect(recording.getAttribute("rel")).toBe("noopener noreferrer");
    expect(within(recording).getByText("LINK")).toBeTruthy();
  });

  it("leaves out a material whose address is not safe, and everything when none is left", () => {
    const { container, rerender } = render(
      <MaterialsList materials={[...materials, { name: "Bad", url: "javascript:alert(1)", note: null }]} />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(screen.queryByText("Bad")).toBeNull();
    rerender(<MaterialsList materials={[{ name: "Bad", url: "javascript:alert(1)", note: null }]} />);
    expect(container.textContent).toBe("");
    rerender(<MaterialsList materials={[]} />);
    expect(container.textContent).toBe("");
  });
});

describe("WorkshopDetails", () => {
  it("lists When, Format and Location and then the admin's own rows, in order", () => {
    render(
      <WorkshopDetails
        when="February–March 2027"
        workshop={workshop({
          format: "Hybrid",
          location: "Purdue University",
          details: [
            { label: "Computing", value: "NSF ACCESS resource Anvil" },
            { label: "Audience", value: "Graduate students" },
          ],
        })}
      />,
    );
    expect(screen.getByRole("heading", { name: "Details" })).toBeTruthy();
    const labels = [...document.querySelectorAll("dt")].map((d) => d.textContent);
    expect(labels).toEqual(["When", "Format", "Location", "Computing", "Audience"]);
    const values = [...document.querySelectorAll("dd")].map((d) => d.textContent);
    expect(values).toEqual(["February–March 2027", "Hybrid", "Purdue University", "NSF ACCESS resource Anvil", "Graduate students"]);
  });

  it("leaves out Format, Location and blank rows when there is nothing to say", () => {
    render(
      <WorkshopDetails
        when="March 3, 2027"
        workshop={workshop({ format: null, location: null, details: [{ label: "Computing", value: "  " }] })}
      />,
    );
    expect([...document.querySelectorAll("dt")].map((d) => d.textContent)).toEqual(["When"]);
  });

  it("ends with the sign-up button, in a new tab", () => {
    render(<WorkshopDetails when="x" workshop={workshop()} />);
    const a = screen.getByRole("link", { name: /Sign up for updates here!/ });
    expect(a.getAttribute("href")).toBe("https://example.org/signup");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("has no button without a sign-up link, or with one that is not safe", () => {
    const { rerender } = render(<WorkshopDetails when="x" workshop={workshop({ signup: null })} />);
    expect(screen.queryByRole("link")).toBeNull();
    rerender(<WorkshopDetails when="x" workshop={workshop({ signup: { label: "Go", url: "javascript:alert(1)" } })} />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
