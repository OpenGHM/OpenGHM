import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { WorkshopsSection } from "./workshops-section";
import { pastWorkshopCard, workshopCard } from "./community.fixtures";

afterEach(cleanup);

describe("WorkshopsSection", () => {
  it("shows the next upcoming workshop as the large card, with its pills, summary, When and Where", () => {
    render(<WorkshopsSection workshops={[workshopCard(), pastWorkshopCard()]} />);
    const card = screen.getByRole("article");
    expect(within(card).getByText("Next workshop")).toBeTruthy();
    expect(within(card).getByText("Online", { selector: "span" })).toBeTruthy();
    expect(within(card).getByRole("heading", { name: "First OpenGHM Workshop Announcement!" })).toBeTruthy();
    expect(within(card).getByText(/excited to announce/)).toBeTruthy();
    expect(within(card).getByText("When")).toBeTruthy();
    expect(within(card).getByText("February–March 2027")).toBeTruthy();
    // No location: Where falls back to the format.
    expect(within(card).getByText("Where")).toBeTruthy();
    expect(within(card).getByText("View details →")).toBeTruthy();
    expect(within(card).getByRole("img", { name: "A workshop" })).toBeTruthy();
  });

  it("links the card once, through its title, to the workshop's page", () => {
    render(<WorkshopsSection workshops={[workshopCard()]} />);
    const links = within(screen.getByRole("article")).getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("/community/workshops/first-openghm-workshop");
    expect(links[0].textContent).toBe("First OpenGHM Workshop Announcement!");
  });

  it("uses a location for Where when there is one", () => {
    render(<WorkshopsSection workshops={[workshopCard({ location: "Purdue University", format: "Hybrid" })]} />);
    expect(screen.getByText("Purdue University")).toBeTruthy();
  });

  it("writes When from the date when there is no label", () => {
    render(<WorkshopsSection workshops={[workshopCard({ when_label: null, date: "2027-03-03", end_date: "2027-03-05" })]} />);
    expect(screen.getByText("March 3–5, 2027")).toBeTruthy();
  });

  it("draws no cover when there is none or its address is not safe", () => {
    const { rerender } = render(<WorkshopsSection workshops={[workshopCard({ cover: null })]} />);
    expect(screen.queryByRole("img")).toBeNull();
    rerender(
      <WorkshopsSection workshops={[workshopCard({ cover: { url: "javascript:alert(1)", alt: "x", caption: null } })]} />,
    );
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("lists the other upcoming workshops as rows under the featured one, soonest first", () => {
    render(
      <WorkshopsSection
        workshops={[
          workshopCard({ id: "c", slug: "c", title: "Third", date: "2027-06-01" }),
          workshopCard({ id: "a", slug: "a", title: "First", date: "2027-02-01" }),
          workshopCard({ id: "b", slug: "b", title: "Second", date: "2027-04-01" }),
        ]}
      />,
    );
    expect(within(screen.getByRole("article")).getByRole("heading", { name: "First" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "More upcoming workshops" })).toBeTruthy();
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((r) => within(r).getByRole("link").textContent)).toEqual(["Second", "Third"]);
  });

  it("lists past workshops under Past workshops with a MON / DD / YYYY date block and hints", () => {
    render(<WorkshopsSection workshops={[workshopCard(), pastWorkshopCard()]} />);
    expect(screen.getByRole("heading", { name: "Past workshops" })).toBeTruthy();
    const row = screen.getByRole("listitem");
    expect(within(row).getByRole("link", { name: "AGU Fall Meeting 2024 Workshop" }).getAttribute("href")).toBe(
      "/community/workshops/agu-2024-workshop",
    );
    const date = row.querySelector("time");
    expect(date?.getAttribute("datetime")).toBe("2024-12-10");
    expect(date?.getAttribute("aria-label")).toBe("December 10, 2024");
    expect(date?.textContent).toBe("DEC102024");
    expect(within(row).getByText("In person")).toBeTruthy();
    expect(within(row).getByText("San Francisco")).toBeTruthy();
    expect(within(row).getByText("Materials")).toBeTruthy();
  });

  it("names only the hints a past workshop has", () => {
    render(<WorkshopsSection workshops={[pastWorkshopCard({ material_count: 3 })]} />);
    expect(screen.getByText("Materials")).toBeTruthy();
    cleanup();
    render(<WorkshopsSection workshops={[pastWorkshopCard({ material_count: 0 })]} />);
    expect(screen.queryByText("Materials")).toBeNull();
  });

  it("sorts past workshops newest first", () => {
    render(
      <WorkshopsSection
        workshops={[
          pastWorkshopCard({ id: "o", slug: "o", title: "Older", date: "2023-05-01" }),
          pastWorkshopCard({ id: "n", slug: "n", title: "Newer", date: "2024-12-10" }),
        ]}
      />,
    );
    expect(screen.getAllByRole("listitem").map((r) => within(r).getByRole("link").textContent)).toEqual(["Newer", "Older"]);
  });

  it("says calmly that none is scheduled when only past ones exist, and still lists them", () => {
    render(<WorkshopsSection workshops={[pastWorkshopCard()]} />);
    expect(screen.queryByRole("article")).toBeNull();
    expect(screen.getByText(/No workshop is scheduled right now/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Past workshops" })).toBeTruthy();
  });

  it("has an empty state when there are no workshops at all", () => {
    render(<WorkshopsSection workshops={[]} />);
    expect(screen.getByText(/No workshops are listed yet/)).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
