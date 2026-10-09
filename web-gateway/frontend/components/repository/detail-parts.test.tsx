import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import {
  ActiveProcessesSection,
  CreatorsSection,
  InfoSection,
  KeywordsSection,
  RelatedLinksSection,
  SpatialCoverageSection,
} from "@/components/repository/detail-parts";

vi.mock("@/components/repository/bounding-box-map-dynamic", () => ({
  BoundingBoxMap: () => <div data-testid="map" />,
}));

afterEach(cleanup);

describe("InfoSection", () => {
  it("lists each label over its value, a link where the row has one, and the whole value on hover where the row clamps", () => {
    render(
      <InfoSection
        title="Dataset Info"
        rows={[
          { label: "WBM Code", value: "1.0.0", title: "Tree hash abc", mono: true },
          { label: "License", value: "GPL-3.0-only", href: "https://spdx.org/licenses/GPL-3.0-only.html" },
          { label: "Model Input", value: "A long name", internalHref: "/repository/model-inputs/x", clamp: 3 },
        ]}
      />,
    );

    expect(screen.getByRole("heading", { level: 2, name: "Dataset Info" })).toBeTruthy();
    expect(screen.getByText("WBM Code").nextElementSibling!.getAttribute("title")).toBe("Tree hash abc");
    const licence = screen.getByRole("link", { name: "GPL-3.0-only" });
    expect(licence.getAttribute("href")).toBe("https://spdx.org/licenses/GPL-3.0-only.html");
    expect(licence.getAttribute("target")).toBe("_blank");
    expect(screen.getByRole("link", { name: "A long name" }).getAttribute("href")).toBe("/repository/model-inputs/x");
    expect(screen.getByText("Model Input").nextElementSibling!.getAttribute("title")).toBe("A long name");
  });
});

describe("RelatedLinksSection", () => {
  it("names a link by its role, and shows the description and the DOI when there are any", () => {
    render(
      <RelatedLinksSection
        links={[
          {
            relation: "isDescribedBy",
            roleName: "Primary Publication",
            url: "https://example.org/paper",
            doi: "10.5194/gmd-15-7287-2022",
            description: "The methodology.",
          },
          { relation: "isDocumentedBy", url: "https://example.org/docs" },
        ]}
      />,
    );

    const primary = screen.getByRole("link", { name: "Primary Publication" });
    expect(primary.getAttribute("href")).toBe("https://example.org/paper");
    expect(primary.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByText("The methodology.")).toBeTruthy();
    expect(screen.getByText("DOI: 10.5194/gmd-15-7287-2022")).toBeTruthy();
    expect(screen.getByRole("link", { name: "isDocumentedBy" }).getAttribute("href")).toBe("https://example.org/docs");
  });
});

describe("CreatorsSection", () => {
  it("shows each creator's initial, and an email link only for one that has an email", () => {
    render(
      <CreatorsSection
        creators={[{ name: "danielle Grogan", email: "danielle.grogan@unh.edu" }, { name: "Shan Zuidema" }]}
      />,
    );

    const items = screen.getAllByRole("listitem");
    expect(within(items[0]).getByText("D")).toBeTruthy();
    expect(within(items[0]).getByRole("link", { name: "danielle.grogan@unh.edu" }).getAttribute("href")).toBe(
      "mailto:danielle.grogan@unh.edu",
    );
    expect(within(items[1]).getByText("S")).toBeTruthy();
    expect(within(items[1]).queryByRole("link")).toBeNull();
  });
});

describe("KeywordsSection and ActiveProcessesSection", () => {
  it("list their entries", () => {
    render(
      <>
        <KeywordsSection keywords={["hydrology", "Water Balance Model"]} />
        <ActiveProcessesSection processes={["Reservoirs", "Irrigated Crops"]} />
      </>,
    );

    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "hydrology",
      "Water Balance Model",
      "Reservoirs",
      "Irrigated Crops",
    ]);
  });
});

describe("SpatialCoverageSection", () => {
  it("shows the four limits in degrees with the projection beside the map", () => {
    render(<SpatialCoverageSection north={52.9167} south={28.9167} east={-77.8333} west={-123.75} projection="EPSG:4326" />);

    expect(screen.getByTestId("map")).toBeTruthy();
    expect(screen.getByText("EPSG:4326")).toBeTruthy();
    expect(screen.getByText("N").nextElementSibling!.textContent).toBe("52.9167°");
    expect(screen.getByText("W").nextElementSibling!.textContent).toBe("-123.75°");
  });
});
