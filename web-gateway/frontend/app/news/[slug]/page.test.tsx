import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { NewsPost } from "@/lib/community/types";

const { getNews } = vi.hoisted(() => ({ getNews: vi.fn() }));
vi.mock("@/lib/home/data", () => ({ getNews }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/components/landing/header", () => ({ Header: () => <header /> }));
vi.mock("@/components/landing/footer", () => ({ Footer: () => <footer /> }));

import NewsPostPage, { generateMetadata } from "./page";

function post(over: Partial<NewsPost> = {}): NewsPost {
  return {
    id: "n-1", state: "published", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", updated_by: "a",
    slug: "v2-released", title: "Python API v2.0 Released", tag: "announcement", summary: "Faster.", cover: null,
    date: "2026-10-10", link_label: null, link_url: null,
    body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Details of the release." }] }] },
    ...over,
  };
}

beforeEach(() => {
  getNews.mockResolvedValue(post());
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const params = (slug = "v2-released") => ({ params: Promise.resolve({ slug }) });

describe("a news post's page", () => {
  it("shows the tag, date, title, summary and body under a Home / News trail", async () => {
    render(await NewsPostPage(params()));
    const crumbs = within(screen.getByRole("navigation", { name: "Breadcrumb" }));
    expect(crumbs.getByRole("link", { name: "News" }).getAttribute("href")).toBe("/news");
    expect(screen.getByText("Announcement")).toBeTruthy();
    expect(screen.getByText("October 10, 2026")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Python API v2.0 Released" })).toBeTruthy();
    expect(screen.getByText("Faster.")).toBeTruthy();
    expect(screen.getByText("Details of the release.")).toBeTruthy();
  });

  it("has a button to its address, labelled by the admin's words, and none for an unsafe one", async () => {
    getNews.mockResolvedValue(post({ link_url: "https://example.org/log", link_label: "Changelog" }));
    render(await NewsPostPage(params()));
    const a = screen.getByRole("link", { name: /Changelog/ });
    expect(a.getAttribute("href")).toBe("https://example.org/log");
    expect(a.getAttribute("target")).toBe("_blank");
    cleanup();
    getNews.mockResolvedValue(post({ link_url: "javascript:alert(1)" }));
    render(await NewsPostPage(params()));
    expect(screen.queryByRole("link", { name: /Read more/ })).toBeNull();
  });

  it("is a 404 when there is no such post", async () => {
    getNews.mockResolvedValue(null);
    await expect(NewsPostPage(params("nope"))).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("takes its title and summary for the metadata, and survives a failed read", async () => {
    expect(await generateMetadata(params())).toEqual({ title: "Python API v2.0 Released | OpenGHM", description: "Faster." });
    getNews.mockImplementation(() => Promise.reject(new Error("down")));
    expect(await generateMetadata(params())).toEqual({ title: "News | OpenGHM" });
  });
});
