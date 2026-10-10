import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { workshop } from "@/components/community/community.fixtures";

const { getWorkshop } = vi.hoisted(() => ({ getWorkshop: vi.fn() }));
vi.mock("@/lib/community/data", () => ({ getWorkshop }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/components/landing/header", () => ({ Header: () => <header /> }));
vi.mock("@/components/landing/footer", () => ({ Footer: () => <footer /> }));

import WorkshopPage, { generateMetadata } from "./page";

beforeEach(() => {
  getWorkshop.mockResolvedValue(workshop());
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const params = (slug = "first-openghm-workshop") => ({ params: Promise.resolve({ slug }) });

describe("a workshop's page", () => {
  it("shows the breadcrumb, status and format pills, title and when label in the band", async () => {
    render(await WorkshopPage(params()));
    const crumbs = within(screen.getByRole("navigation", { name: "Breadcrumb" }));
    expect(crumbs.getByRole("link", { name: "Community" }).getAttribute("href")).toBe("/community");
    expect(crumbs.getByRole("link", { name: "Workshops" }).getAttribute("href")).toBe("/community?tab=workshops");
    expect(screen.getByText("Upcoming")).toBeTruthy();
    // The format shows in the band and again in the Details card.
    expect(screen.getAllByText("Online")).toHaveLength(2);
    expect(screen.getByRole("heading", { level: 1, name: "First OpenGHM Workshop Announcement!" })).toBeTruthy();
    expect(screen.getByText("February–March 2027", { selector: "p span" })).toBeTruthy();
  });

  it("says Past event for a past workshop", async () => {
    getWorkshop.mockResolvedValue(workshop({ status: "past" }));
    render(await WorkshopPage(params()));
    expect(screen.getByText("Past event")).toBeTruthy();
  });

  it("renders the body, the Details card and the sign-up button", async () => {
    render(await WorkshopPage(params()));
    expect(screen.getByText("We are excited to announce the first workshop.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Details" })).toBeTruthy();
    expect(screen.getByText("NSF ACCESS resource Anvil")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Sign up for updates here!/ })).toBeTruthy();
  });

  it("shows the cover with its caption and the materials when there are some", async () => {
    getWorkshop.mockResolvedValue(
      workshop({
        cover: { url: "https://example.org/cover.jpg", alt: "The room", caption: "Day one" },
        materials: [{ name: "Slides.pdf", url: "https://example.org/slides.pdf", note: null }],
      }),
    );
    render(await WorkshopPage(params()));
    expect(screen.getByRole("img", { name: "The room" }).getAttribute("src")).toBe("https://example.org/cover.jpg");
    expect(screen.getByText("Day one")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Materials" })).toBeTruthy();
  });

  it("shows no Materials when there are none", async () => {
    render(await WorkshopPage(params()));
    expect(screen.queryByRole("heading", { name: "Materials" })).toBeNull();
  });

  it("falls back to the summary when the workshop has no body", async () => {
    getWorkshop.mockResolvedValue(workshop({ body: null, summary: "Just a summary." }));
    render(await WorkshopPage(params()));
    expect(screen.getByText("Just a summary.")).toBeTruthy();
  });

  it("is a 404 when there is no such workshop", async () => {
    getWorkshop.mockResolvedValue(null);
    await expect(WorkshopPage(params("nope"))).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("lets a backend failure through, for the route's error boundary", async () => {
    getWorkshop.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(WorkshopPage(params())).rejects.toThrow("ECONNREFUSED");
  });
});

describe("a workshop's metadata", () => {
  it("takes the title and summary", async () => {
    await expect(generateMetadata(params())).resolves.toEqual({
      title: "First OpenGHM Workshop Announcement! | OpenGHM",
      description: "We are excited to announce the first OpenGHM training online workshop.",
    });
  });

  it("falls back to a plain title when there is no such workshop or the backend is down", async () => {
    getWorkshop.mockResolvedValue(null);
    await expect(generateMetadata(params())).resolves.toEqual({ title: "Workshop | OpenGHM" });
    getWorkshop.mockRejectedValue(new Error("down"));
    await expect(generateMetadata(params())).resolves.toEqual({ title: "Workshop | OpenGHM" });
  });
});
