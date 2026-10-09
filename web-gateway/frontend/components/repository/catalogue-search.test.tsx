import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CatalogueSearch, CatalogueSearchProvider } from "./catalogue-search";

afterEach(cleanup);

function setup(query = "") {
  const onQueryChange = vi.fn();
  render(
    <CatalogueSearchProvider query={query} onQueryChange={onQueryChange}>
      <CatalogueSearch />
      <input aria-label="Other field" />
      <textarea aria-label="Notes" />
      <button type="button">Other button</button>
      <div id="catalogue-results" tabIndex={-1} />
    </CatalogueSearchProvider>
  );
  return { onQueryChange };
}

const search = () => screen.getByRole("searchbox", { name: "Search the repository" }) as HTMLInputElement;

describe("CatalogueSearch", () => {
  it("is a search landmark with the query in its box", () => {
    setup("gpcc");
    expect(screen.getByRole("search")).toBeTruthy();
    expect(search().value).toBe("gpcc");
  });

  it("reports typing and shows the / hint while empty", () => {
    const { onQueryChange } = setup();
    fireEvent.change(search(), { target: { value: "gpcc" } });
    expect(onQueryChange).toHaveBeenCalledWith("gpcc");
    expect(document.querySelector("kbd")?.textContent).toBe("/");
  });

  it("swaps the hint for a Clear search button once there is text", () => {
    const { onQueryChange } = setup("gpcc");
    expect(document.querySelector("kbd")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(onQueryChange).toHaveBeenCalledWith("");
    expect(document.activeElement).toBe(search());
  });

  it("moves on to the results, without reloading the page, when Search is pressed", () => {
    setup("gpcc");
    const results = document.getElementById("catalogue-results")!;
    const scroll = vi.fn();
    results.scrollIntoView = scroll;
    const submit = new Event("submit", { bubbles: true, cancelable: true });
    fireEvent(screen.getByRole("search"), submit);
    expect(submit.defaultPrevented).toBe(true);
    expect(scroll).toHaveBeenCalled();
    expect(document.activeElement).toBe(results);
    expect(screen.getByRole("button", { name: "Search" }).getAttribute("type")).toBe("submit");
  });

  it("takes focus on / from anywhere outside a text field", () => {
    setup();
    screen.getByRole("button", { name: "Other button" }).focus();
    const event = new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    expect(document.activeElement).toBe(search());
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves / alone while typing in a text field", () => {
    setup();
    for (const name of ["Other field", "Notes"]) {
      const field = screen.getByLabelText(name);
      field.focus();
      const event = new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true });
      field.dispatchEvent(event);
      expect(document.activeElement).toBe(field);
      expect(event.defaultPrevented).toBe(false);
    }
  });

  it("leaves a modified / alone", () => {
    setup();
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "/", ctrlKey: true, bubbles: true }));
    expect(document.activeElement).not.toBe(search());
  });

  it("lets go of the box on Escape", () => {
    setup();
    search().focus();
    fireEvent.keyDown(search(), { key: "Escape" });
    expect(document.activeElement).toBe(document.body);
  });
});
