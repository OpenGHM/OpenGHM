import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { feedItem } from "@/components/landing/home-feed.fixtures";

const { fetchAllUpdates } = vi.hoisted(() => ({ fetchAllUpdates: vi.fn() }));
vi.mock("@/lib/home/data", () => ({ fetchAllUpdates }));
vi.mock("@/components/landing/header", () => ({ Header: () => <header /> }));
vi.mock("@/components/landing/footer", () => ({ Footer: () => <footer /> }));

import NewsPage from "./page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the news page", () => {
  it("lists every update as a card with its date, under a Home / News trail", async () => {
    fetchAllUpdates.mockResolvedValue({ items: [feedItem(), feedItem({ id: "n-2", title: "Older", date: "2026-01-02" })] });
    render(await NewsPage());
    expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("link", { name: "Home" }).getAttribute("href")).toBe("/");
    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(screen.getByText("January 2, 2026")).toBeTruthy();
  });

  it("says so when nothing has been posted", async () => {
    fetchAllUpdates.mockResolvedValue({ items: [] });
    render(await NewsPage());
    expect(screen.getByText("Nothing has been posted yet.")).toBeTruthy();
  });

  it("still opens, with an error box, when the backend does not answer", async () => {
    fetchAllUpdates.mockRejectedValue(new Error("down"));
    render(await NewsPage());
    expect(screen.getByRole("alert").textContent).toMatch(/could not be loaded/);
    expect(screen.getByRole("heading", { level: 1, name: "All updates" })).toBeTruthy();
  });
});
