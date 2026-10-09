import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AsideLayout } from "@/components/workspace/aside-layout";

afterEach(cleanup);

describe("AsideLayout, with the aside hidden below xl", () => {
  it("is a two-column grid from xl with a sticky aside that is not there below it", () => {
    render(
      <AsideLayout label="Help" below="hidden" aside={<p>the aside</p>}>
        <p>the page</p>
      </AsideLayout>
    );
    const aside = screen.getByRole("complementary", { name: "Help", hidden: true });
    for (const name of ["hidden", "xl:block", "xl:sticky", "xl:top-5", "xl:overflow-y-auto", "xl:self-start"]) {
      expect(aside.classList.contains(name)).toBe(true);
    }
    expect(screen.getByText("the page").parentElement?.parentElement?.className).toContain("xl:grid");
  });
});

describe("AsideLayout, with the aside in the flow below xl", () => {
  it("reads lead, aside, rest, and puts the aside in the second column across both rows from xl", () => {
    render(
      <AsideLayout label="Details" below="flow" lead={<p>the lead</p>} aside={<p>the aside</p>}>
        <p>the rest</p>
      </AsideLayout>
    );
    const aside = screen.getByRole("complementary", { name: "Details" });
    const lead = screen.getByText("the lead");
    const rest = screen.getByText("the rest");
    expect(lead.compareDocumentPosition(aside) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(aside.compareDocumentPosition(rest) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Visible below xl, a column from it.
    expect(aside.classList.contains("hidden")).toBe(false);
    for (const name of ["xl:col-start-2", "xl:row-start-1", "xl:row-span-2", "xl:sticky", "xl:self-start"]) {
      expect(aside.classList.contains(name)).toBe(true);
    }
    expect(lead.parentElement?.className).toContain("xl:col-start-1");
    expect(rest.parentElement?.className).toContain("xl:row-start-2");
  });
});
