import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const { saveHomeSettings, fetchPinCandidates, pinItem, unpinItem, createNews, updateNews, deleteNews, bulkContent, toast, refresh, replace } =
  vi.hoisted(() => ({
    saveHomeSettings: vi.fn(),
    fetchPinCandidates: vi.fn(),
    pinItem: vi.fn(),
    unpinItem: vi.fn(),
    createNews: vi.fn(),
    updateNews: vi.fn(),
    deleteNews: vi.fn(),
    bulkContent: vi.fn(),
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
    refresh: vi.fn(),
    replace: vi.fn(),
  }));
vi.mock("@/lib/home/admin-actions", () => ({ saveHomeSettings, fetchPinCandidates, pinItem, unpinItem }));
vi.mock("@/lib/community/admin-actions", () => ({ createNews, updateNews, deleteNews, bulkContent, bulkDeleteFiles: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, replace, push: vi.fn() }),
  usePathname: () => "/admin/home/updates",
}));
vi.mock("@/components/admin/community/rich-text-editor", () => ({
  RichTextEditor: () => <div>body editor</div>,
}));

import { NewsEditor } from "@/components/admin/home/news-editor";
import { NewsList } from "@/components/admin/home/news-list";
import { UpdatesManager } from "@/components/admin/home/updates-manager";
import { feedItem } from "@/components/landing/home-feed.fixtures";
import type { NewsPost } from "@/lib/community/types";
import type { HomeUpdatesAdmin, PinStatus } from "@/lib/home/types";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

const pin = (id: string, title: string, over: Partial<PinStatus> = {}): PinStatus => ({
  kind: "news", id, title, available: true, reason: null, item: feedItem({ id, title, pinned: true }), ...over,
});
const settings = (over: Partial<HomeUpdatesAdmin> = {}): HomeUpdatesAdmin => ({
  title: "Latest Snapshots & News", eyebrow: "What's New", count: 3,
  sources: { news: true, workshops: true, datasets: true },
  pins: [pin("a", "Alpha"), pin("b", "Beta"), pin("c", "Gamma")],
  updated_at: null, updated_by: null, ...over,
});
const candidates = [
  feedItem({ id: "x", title: "Candidate X" }),
  feedItem({ id: "a", title: "Alpha", pinned: true }),
  feedItem({ kind: "dataset", id: "ds", title: "Dataset D", tag: "dataset", tag_label: "New snapshot" }),
];

describe("the Latest updates page", () => {
  const renderPage = (s = settings(), preview = [feedItem({ id: "a", title: "Alpha", pinned: true }), feedItem({ id: "z", title: "Zed" })]) => {
    fetchPinCandidates.mockResolvedValue({ ok: true, data: candidates });
    return render(<UpdatesManager settings={s} preview={preview} />);
  };

  it("previews what the home page shows now, with the pinned badge", async () => {
    renderPage();
    const list = screen.getByRole("list", { name: "What the home page shows now" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("Pinned")).toBeTruthy();
    expect(within(rows[0]).getByText("Announcement")).toBeTruthy();
    expect(within(rows[1]).queryByText("Pinned")).toBeNull();
    await waitFor(() => expect(fetchPinCandidates).toHaveBeenCalled());
  });

  it("says so when the preview could not be read, and still shows the form", async () => {
    renderPage(settings(), null as never);
    expect(screen.getByText(/Couldn't load the preview/)).toBeTruthy();
    expect(screen.getByLabelText("Title")).toBeTruthy();
    await waitFor(() => expect(fetchPinCandidates).toHaveBeenCalled());
  });

  it("saves the words, the count, the sources and the pins in their order", async () => {
    saveHomeSettings.mockResolvedValue({ ok: true, data: settings() });
    renderPage();
    fireEvent.change(screen.getByLabelText("Number of cards"), { target: { value: "6" } });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Our news" } });
    fireEvent.click(screen.getByRole("switch", { name: "Workshops" }));
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(saveHomeSettings).toHaveBeenCalledWith({
        title: "Our news", eyebrow: "What's New", count: 6,
        sources: { news: true, workshops: false, datasets: true },
        pins: [{ kind: "news", id: "a" }, { kind: "news", id: "b" }, { kind: "news", id: "c" }],
      })
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Home page updates saved."));
    expect(refresh).toHaveBeenCalled();
  });

  it("refuses a count outside 1 to 12 without sending anything", async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("Number of cards"), { target: { value: "13" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Use a whole number from 1 to 12.")).toBeTruthy();
    expect(saveHomeSettings).not.toHaveBeenCalled();
  });

  it("shows the backend's refusal and keeps the form", async () => {
    saveHomeSettings.mockResolvedValue({ ok: false, reason: "error", status: 422, message: "The pinned news 'a' no longer exists. Remove the pin." });
    renderPage();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Changed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText(/no longer exists/)).toBeTruthy();
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Changed");
  });

  it("has Cancel, which leaves the page", () => {
    renderPage();
    expect(screen.getByRole("link", { name: "Cancel" })).toBeTruthy();
  });

  describe("the pinned list", () => {
    const names = () => within(screen.getByRole("list", { name: "Pinned items" })).getAllByRole("listitem").map((li) => li.querySelector("p")?.textContent);
    const drag = async (handle: HTMLElement, ...keys: string[]) => {
      handle.focus();
      fireEvent.keyDown(handle, { key: " ", code: "Space" });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      for (const code of keys) {
        await act(async () => {
          fireEvent.keyDown(document, { key: code, code });
        });
      }
      await act(async () => {
        fireEvent.keyDown(document, { key: " ", code: "Space" });
      });
    };
    const layOut = () =>
      vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
        const rows = Array.from(document.querySelectorAll('ol[aria-label="Pinned items"] > li'));
        const box = (top: number, height: number) => ({ x: 0, y: top, top, left: 0, right: 600, bottom: top + height, width: 600, height, toJSON: () => ({}) });
        if (this.getAttribute("aria-label") === "Pinned items") return box(0, rows.length * 40);
        const at = rows.indexOf(this.closest("li") as HTMLLIElement);
        return box(at < 0 ? 0 : at * 40, 40);
      });

    it("lists the pins in order, each with a handle and an Unpin button", async () => {
      renderPage();
      expect(names()).toEqual(["Alpha", "Beta", "Gamma"]);
      expect(screen.getByRole("button", { name: "Drag to reorder Beta" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Unpin Beta" })).toBeTruthy();
      await waitFor(() => expect(fetchPinCandidates).toHaveBeenCalled());
    });

    it("moves a pin with the keyboard, and the saved order follows it", async () => {
      saveHomeSettings.mockResolvedValue({ ok: true, data: settings() });
      layOut();
      renderPage();
      await drag(screen.getByRole("button", { name: "Drag to reorder Gamma" }), "ArrowUp", "ArrowUp");
      expect(names()).toEqual(["Gamma", "Alpha", "Beta"]);
      expect(screen.getByText("Unsaved changes")).toBeTruthy();
      expect(saveHomeSettings).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
      await waitFor(() =>
        expect(saveHomeSettings.mock.calls[0][0].pins.map((p: { id: string }) => p.id)).toEqual(["c", "a", "b"])
      );
    });

    it("unpins a row, and the picker then offers it again", async () => {
      renderPage();
      await screen.findByRole("button", { name: "Pin Candidate X" });
      expect(screen.getByRole("button", { name: "Pin Alpha" }).hasAttribute("disabled")).toBe(true);
      fireEvent.click(screen.getByRole("button", { name: "Unpin Alpha" }));
      expect(names()).toEqual(["Beta", "Gamma"]);
      expect(screen.getByRole("button", { name: "Pin Alpha" }).hasAttribute("disabled")).toBe(false);
    });

    it("flags a pin that does not show and keeps it until it is removed", async () => {
      renderPage(settings({ pins: [pin("a", "Alpha"), pin("gone", "", { available: false, reason: "missing", title: null, item: null })] }));
      expect(screen.getByText(/No longer exists: not shown/)).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: /^Unpin news gone|^Unpin Dataset|^Unpin News post gone/i }));
      expect(names()).toEqual(["Alpha"]);
      await waitFor(() => expect(fetchPinCandidates).toHaveBeenCalled());
    });

    it("says how many pins show when there are more than the page has room for", async () => {
      renderPage(settings({ count: 2 }));
      expect(screen.getByText(/room for 2, so only the first 2 pins show/)).toBeTruthy();
      await waitFor(() => expect(fetchPinCandidates).toHaveBeenCalled());
    });
  });

  describe("the picker", () => {
    it("lists the candidates, and pins one to the end of the list", async () => {
      renderPage();
      fireEvent.click(await screen.findByRole("button", { name: "Pin Candidate X" }));
      const list = screen.getByRole("list", { name: "Pinned items" });
      const rows = within(list).getAllByRole("listitem");
      expect(rows).toHaveLength(4);
      expect(rows[3].textContent).toContain("Candidate X");
      expect(screen.getByRole("button", { name: "Pin Candidate X" }).hasAttribute("disabled")).toBe(true);
    });

    it("searches and filters by kind through the backend", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        renderPage();
        await screen.findByRole("button", { name: "Pin Candidate X" });
        fireEvent.change(screen.getByLabelText("Search items to pin"), { target: { value: "rivers" } });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(300);
        });
        expect(fetchPinCandidates).toHaveBeenLastCalledWith("rivers", "all");
        fireEvent.change(screen.getByLabelText("Kind"), { target: { value: "dataset" } });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(300);
        });
        expect(fetchPinCandidates).toHaveBeenLastCalledWith("rivers", "dataset");
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not save the form when Enter is pressed in the search box", async () => {
      renderPage();
      await screen.findByRole("button", { name: "Pin Candidate X" });
      fireEvent.keyDown(screen.getByLabelText("Search items to pin"), { key: "Enter" });
      expect(saveHomeSettings).not.toHaveBeenCalled();
    });

    it("disables every Pin when twelve are pinned", async () => {
      const twelve = Array.from({ length: 12 }, (_, i) => pin(`p${i}`, `Pinned ${i}`));
      renderPage(settings({ pins: twelve }));
      await screen.findByRole("button", { name: "Pin Candidate X" });
      expect(screen.getByRole("button", { name: "Pin Candidate X" }).hasAttribute("disabled")).toBe(true);
      expect(screen.getByText(/The pins are full/)).toBeTruthy();
    });

    it("says why when the candidates cannot be loaded", async () => {
      fetchPinCandidates.mockResolvedValue({ ok: false, reason: "error", status: 500, message: "The service is down." });
      render(<UpdatesManager settings={settings({ pins: [] })} preview={[]} />);
      expect((await screen.findByRole("alert")).textContent).toBe("The service is down.");
    });
  });
});

describe("the news list", () => {
  const meta = { created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-02T00:00:00Z", updated_by: "u1" };
  const post = (over: Partial<NewsPost>): NewsPost => ({
    id: "n1", state: "published", slug: "one", title: "Post one", tag: "announcement", summary: "", cover: null,
    date: "2026-10-09", link_label: null, link_url: null, body: null, ...meta, ...over,
  });
  const posts = [
    post({}),
    post({ id: "n2", slug: "two", title: "Post two", state: "draft", tag: "event" }),
    post({ id: "n3", slug: "three", title: "Post three", body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] } }),
  ];

  it("shows title, tag, date and state, each title a link to its editor", () => {
    render(<NewsList posts={posts} pinned={[]} />);
    expect(screen.getByRole("link", { name: "Post one" }).getAttribute("href")).toBe("/admin/home/news/n1");
    expect(screen.getAllByText("Announcement")).toHaveLength(2);
    expect(screen.getByText("Community Event")).toBeTruthy();
    expect(screen.getAllByText("Visible")).toHaveLength(2);
  });

  it("has View on site only for a published post that has page text", () => {
    render(<NewsList posts={posts} pinned={[]} />);
    expect(screen.getByRole("link", { name: "View Post three on site" }).getAttribute("href")).toBe("/news/three");
    expect(screen.queryByRole("link", { name: "View Post one on site" })).toBeNull();
  });

  it("has Pin for a published post, Unpin for a pinned one, and nothing for a draft", () => {
    render(<NewsList posts={posts} pinned={["n3"]} />);
    expect(screen.getByRole("button", { name: "Pin Post one to the home page" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unpin Post three from the home page" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Post two (to|from) the home page/ })).toBeNull();
    expect(screen.getByText("Pinned")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unpin Post three from the home page" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Pin Post one to the home page" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Hide Post one" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show Post two" })).toBeTruthy();
  });

  it("pins a post at once", async () => {
    pinItem.mockResolvedValue({ ok: true, data: {} });
    render(<NewsList posts={posts} pinned={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Pin Post one to the home page" }));
    await waitFor(() => expect(pinItem).toHaveBeenCalledWith("news", "n1"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Pinned to the home page."));
  });

  it("publishes the selected rows through the bulk route", async () => {
    bulkContent.mockResolvedValue({ ok: true, data: { done: ["n2"], missing: [] } });
    render(<NewsList posts={posts} pinned={null} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Post two" }));
    expect(screen.getByText("1 selected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    await waitFor(() => expect(bulkContent).toHaveBeenCalledWith("news", "publish", ["n2"]));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("1 news post shown on the site."));
  });

  it("asks before it deletes", async () => {
    bulkContent.mockResolvedValue({ ok: true, data: { done: ["n1"], missing: [] } });
    render(<NewsList posts={posts} pinned={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Post one" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Delete this news post?")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete news post" }));
    await waitFor(() => expect(bulkContent).toHaveBeenCalledWith("news", "delete", ["n1"]));
  });

  it("says what to do when there are none", () => {
    render(<NewsList posts={[]} pinned={null} />);
    expect(screen.getByText("No news posts yet.")).toBeTruthy();
  });
});

describe("the news editor", () => {
  const saved = (over: Partial<NewsPost> = {}): NewsPost => ({
    id: "n9", state: "draft", slug: "python-api-v2", title: "Python API v2", tag: "announcement", summary: "",
    cover: null, date: "2026-10-10", link_label: null, link_url: null, body: null,
    created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", updated_by: "u1", ...over,
  });

  it("derives the slug from the title and creates the post, then opens its page", async () => {
    createNews.mockResolvedValue({ ok: true, data: saved() });
    render(<NewsEditor post={null} />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Python API v2" } });
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe("python-api-v2");
    fireEvent.change(screen.getByLabelText("Tag"), { target: { value: "announcement" } });
    fireEvent.click(screen.getByRole("button", { name: "Create post" }));
    await waitFor(() => expect(createNews).toHaveBeenCalled());
    expect(createNews.mock.calls[0][0]).toMatchObject({
      state: "draft", slug: "python-api-v2", title: "Python API v2", tag: "announcement", cover: null,
      link_label: null, link_url: null, body: null,
    });
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/admin/home/news/n9"));
  });

  it("marks what is missing and sends nothing", async () => {
    render(<NewsEditor post={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Create post" }));
    expect(await screen.findByText("Give the post a title.")).toBeTruthy();
    expect(createNews).not.toHaveBeenCalled();
  });

  it("saves a stored post with Ctrl+S, and has Cancel back to the list", async () => {
    updateNews.mockResolvedValue({ ok: true, data: saved({ title: "Changed" }) });
    render(<NewsEditor post={saved()} />);
    expect(screen.getByRole("link", { name: "Cancel" }).getAttribute("href")).toBe("/admin/home/news");
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Changed" } });
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() => expect(updateNews).toHaveBeenCalledWith("n9", expect.objectContaining({ title: "Changed" })));
  });

  it("puts a slug the backend refused beside the slug", async () => {
    createNews.mockResolvedValue({ ok: false, reason: "error", status: 409, code: "slug_taken", message: "Another item already uses that slug.", errors: [{ path: "slug", message: "Another item already uses that slug." }] });
    render(<NewsEditor post={null} />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Taken" } });
    fireEvent.click(screen.getByRole("button", { name: "Create post" }));
    expect((await screen.findAllByText("Another item already uses that slug.")).length).toBeGreaterThan(0);
  });

  it("offers View on site only for a published post that has page text", () => {
    const body = { type: "doc" as const, content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] };
    const { rerender } = render(<NewsEditor post={saved({ state: "published", body })} />);
    expect(screen.getByRole("link", { name: /View on site/ }).getAttribute("href")).toBe("/news/python-api-v2");
    rerender(<NewsEditor key="b" post={saved({ state: "published", body: null })} />);
    expect(screen.queryByRole("link", { name: /View on site/ })).toBeNull();
  });

  it("asks before it deletes, then goes back to the list", async () => {
    deleteNews.mockResolvedValue({ ok: true, data: null });
    render(<NewsEditor post={saved()} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(deleteNews).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete post" }));
    await waitFor(() => expect(deleteNews).toHaveBeenCalledWith("n9"));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/admin/home/news"));
  });
});
