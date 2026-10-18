import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", () => ({ getApiClient: vi.fn() }));

import { withDefaults } from "@/lib/home/data";
import { homeToForm, homeToInput, pinRowFromItem, validateHome } from "@/lib/home/admin-forms";
import { emptyNewsForm, newsToInput, validateNews } from "@/lib/community/admin-forms";
import { feedItem } from "@/components/landing/home-feed.fixtures";
import type { HomeUpdatesAdmin } from "@/lib/home/types";

const admin: HomeUpdatesAdmin = {
  title: "T", eyebrow: "E", count: 5, sources: { news: true, workshops: false, datasets: true },
  pins: [
    { kind: "news", id: "a", available: true, reason: null, title: "A", item: feedItem({ id: "a", title: "A" }) },
    { kind: "news", id: "b", available: false, reason: "missing", title: null, item: null },
  ],
  updated_at: null, updated_by: null,
};

describe("the feed's defaults", () => {
  it("fills what the backend left out and keeps what it sent", () => {
    expect(withDefaults(null)).toEqual({
      settings: { title: "Latest Snapshots & News", eyebrow: "What's New", count: 3, sources: { news: true, workshops: true, datasets: true } },
      items: [],
    });
    const got = withDefaults({ settings: { title: "", eyebrow: "Hi", count: 6 } as never, items: [feedItem()] });
    expect(got.settings.title).toBe("Latest Snapshots & News");
    expect([got.settings.eyebrow, got.settings.count, got.items.length]).toEqual(["Hi", 6, 1]);
  });
});

describe("the Latest updates form", () => {
  it("round-trips the settings and sends the pins in order without their status", () => {
    const input = homeToInput(homeToForm(admin));
    expect(input).toEqual({
      title: "T", eyebrow: "E", count: 5, sources: admin.sources,
      pins: [{ kind: "news", id: "a" }, { kind: "news", id: "b" }],
    });
  });

  it("checks the words and the count", () => {
    const form = homeToForm(admin);
    expect(validateHome(form)).toEqual({});
    expect(validateHome({ ...form, title: " " }).title).toBeTruthy();
    expect(validateHome({ ...form, eyebrow: "" }).eyebrow).toBeTruthy();
    for (const bad of ["0", "13", "", "2.5", "abc"]) expect(validateHome({ ...form, count: bad }).count).toMatch(/1 to 12/);
    for (const good of ["1", "12"]) expect(validateHome({ ...form, count: good }).count).toBeUndefined();
  });

  it("makes a pin row from a candidate", () => {
    expect(pinRowFromItem(feedItem({ id: "x", title: "X" }))).toMatchObject({ kind: "news", id: "x", title: "X", reason: null });
  });
});

describe("the news form", () => {
  it("starts as a draft dated today and needs a title and a slug", () => {
    const form = emptyNewsForm("2026-10-10");
    expect(form).toMatchObject({ state: "draft", date: "2026-10-10" });
    expect(Object.keys(validateNews(form)).sort()).toEqual(["slug", "title"]);
  });

  it("sends blank optional text as null and trims", () => {
    const form = { ...emptyNewsForm("2026-10-10"), title: " Hi ", slug: "hi", linkLabel: " ", linkUrl: "" };
    expect(newsToInput(form)).toMatchObject({ title: "Hi", cover: null, link_label: null, link_url: null, body: null });
  });

  it("checks the date, the cover, the link and the lengths", () => {
    const ok = { ...emptyNewsForm("2026-10-10"), title: "Hi", slug: "hi" };
    expect(validateNews({ ...ok, date: "2026-13-01" }).date).toBeTruthy();
    expect(validateNews({ ...ok, cover: { url: "http://x.org/a.png", alt: "a" } })["cover.url"]).toBeTruthy();
    expect(validateNews({ ...ok, cover: { url: "https://x.org/a.png", alt: "" } })["cover.alt"]).toBeTruthy();
    expect(validateNews({ ...ok, linkUrl: "mailto:a@b.org" }).link_url).toBeTruthy();
    expect(validateNews({ ...ok, linkUrl: "/repository" }).link_url).toBeUndefined();
    expect(validateNews({ ...ok, summary: "x".repeat(401) }).summary).toBeTruthy();
  });
});
