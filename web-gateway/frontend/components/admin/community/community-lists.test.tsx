import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const { reorderTutorials, bulkContent, pinItem, unpinItem, toast, refresh } = vi.hoisted(() => ({
  reorderTutorials: vi.fn(),
  bulkContent: vi.fn(),
  pinItem: vi.fn(),
  unpinItem: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  refresh: vi.fn(),
}));
vi.mock("@/lib/community/admin-actions", () => ({ reorderTutorials, bulkContent, bulkDeleteFiles: vi.fn() }));
vi.mock("@/lib/home/admin-actions", () => ({ pinItem, unpinItem }));
vi.mock("sonner", () => ({ toast }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/admin/community/workshops/w1",
}));

import { AuditLogTable } from "@/components/admin/audit-log-table";
import { TutorialList } from "@/components/admin/community/tutorial-list";
import { WorkshopList } from "@/components/admin/community/workshop-list";
import type { Tutorial, Workshop } from "@/lib/community/types";

// Radix menus and dnd-kit read what jsdom lacks.
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

const meta = { created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-02T00:00:00Z", updated_by: "u1" };

const workshop = (over: Partial<Workshop>): Workshop => ({
  id: "w1",
  state: "published",
  status: "upcoming",
  slug: "first",
  title: "First workshop",
  summary: "",
  date: "2027-02-15",
  end_date: "2027-03-31",
  when_label: null,
  format: null,
  location: null,
  cover: null,
  signup: null,
  details: [],
  materials: [],
  body: null,
  ...meta,
  ...over,
});

const tutorial = (over: Partial<Tutorial>): Tutorial => ({
  id: "t1",
  state: "published",
  slug: "one",
  title: "Tutorial one",
  summary: "",
  kind: "gateway",
  minutes: 20,
  level: "beginner",
  snippet: "",
  action_label: null,
  url: null,
  body: null,
  position: 0,
  ...meta,
  ...over,
});

describe("the workshop list", () => {
  it("shows title, dates, status and state, each title a link to its editor", () => {
    const { container } = render(
      <WorkshopList
        workshops={[
          workshop({}),
          workshop({ id: "w2", title: "Old workshop", slug: "old", status: "past", state: "draft", end_date: null, date: "2024-12-10" }),
        ]}
      />
    );
    const link = screen.getByRole("link", { name: "First workshop" });
    expect(link.getAttribute("href")).toBe("/admin/community/workshops/w1");
    expect(screen.getByText("Upcoming")).toBeTruthy();
    expect(screen.getByText("Past")).toBeTruthy();
    expect(screen.getByText("Published")).toBeTruthy();
    expect(screen.getByText("Draft")).toBeTruthy();
    // A range prints both days; a single day prints one.
    const days = Array.from(container.querySelectorAll("time[datetime]"))
      .map((t) => t.getAttribute("datetime"))
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d ?? ""));
    expect(days).toEqual(["2027-02-15", "2027-03-31", "2024-12-10"]);
  });

  it("says what to do when there are none", () => {
    render(<WorkshopList workshops={[]} />);
    expect(screen.getByText("No workshops yet.")).toBeTruthy();
    expect(screen.getByText(/New workshop/)).toBeTruthy();
  });
});

describe("the tutorial list", () => {
  const three = [
    tutorial({ id: "a", title: "Alpha", slug: "alpha" }),
    tutorial({ id: "b", title: "Beta", slug: "beta", kind: "video", level: "advanced", minutes: null }),
    tutorial({ id: "c", title: "Gamma", slug: "gamma", state: "draft" }),
  ];
  const titles = () => screen.getAllByRole("row").slice(1).map((r) => within(r).getByRole("link").textContent);
  const positions = () => screen.getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[2].textContent);

  /** jsdom has no layout: give each row a 40 px slot so dnd-kit can tell where a move lands. */
  const layOutRows = () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const rows = Array.from(document.querySelectorAll("tbody tr"));
      const box = (top: number, height: number) => ({ x: 0, y: top, top, left: 0, right: 600, bottom: top + height, width: 600, height, toJSON: () => ({}) });
      if (this.tagName === "TBODY") return box(0, rows.length * 40);
      const at = rows.indexOf(this.closest("tr") as HTMLTableRowElement);
      return box(at < 0 ? 0 : at * 40, 40);
    });
  };
  /** The keyboard drag of a handle: Space, then these keys, then Space. */
  const dragWithKeyboard = async (handle: HTMLElement, ...keys: string[]) => {
    handle.focus();
    fireEvent.keyDown(handle, { key: " ", code: "Space" });
    // dnd-kit starts listening for the arrows one tick after the pick-up.
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

  it("lists them in the given order, each with a drag handle named for it and its position", () => {
    render(<TutorialList tutorials={three} />);
    expect(titles()).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(positions()).toEqual(["01", "02", "03"]);
    for (const t of ["Alpha", "Beta", "Gamma"]) expect(screen.getByRole("button", { name: `Drag to reorder ${t}` })).toBeTruthy();
    // The arrow buttons are gone.
    expect(screen.queryByRole("button", { name: /Move .* (up|down)/ })).toBeNull();
    expect(screen.getByText("Video · Advanced")).toBeTruthy();
  });

  it("tells a screen reader how to use the handle", () => {
    render(<TutorialList tutorials={three} />);
    const handle = screen.getByRole("button", { name: "Drag to reorder Alpha" });
    const described = document.getElementById(handle.getAttribute("aria-describedby") ?? "");
    expect(described?.textContent).toMatch(/press Space to pick the tutorial up.*arrow keys.*Escape/);
  });

  it("moves a row with the keyboard at once, renumbers, sends the whole new order and announces it", async () => {
    reorderTutorials.mockResolvedValue({ ok: true, data: null });
    layOutRows();
    render(<TutorialList tutorials={three} />);
    await dragWithKeyboard(screen.getByRole("button", { name: "Drag to reorder Gamma" }), "ArrowUp");
    await waitFor(() => expect(reorderTutorials).toHaveBeenCalledWith(["a", "c", "b"]));
    expect(titles()).toEqual(["Alpha", "Gamma", "Beta"]);
    expect(positions()).toEqual(["01", "02", "03"]);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const live = Array.from(document.querySelectorAll("[aria-live]")).map((n) => n.textContent).join(" ");
    expect(live).toMatch(/Gamma dropped at position 2 of 3\./);
    // The keyboard user keeps their place: the handle has the focus again.
    expect((document.activeElement as HTMLElement).getAttribute("aria-label")).toBe("Drag to reorder Gamma");
  });

  it("puts the list back and says why when the backend refuses", async () => {
    reorderTutorials.mockResolvedValue({ ok: false, reason: "error", message: "Order not saved." });
    layOutRows();
    render(<TutorialList tutorials={three} />);
    await dragWithKeyboard(screen.getByRole("button", { name: "Drag to reorder Alpha" }), "ArrowDown");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Order not saved."));
    expect(titles()).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("says the session ended instead of a generic failure", async () => {
    reorderTutorials.mockResolvedValue({ ok: false, reason: "session_expired" });
    layOutRows();
    render(<TutorialList tutorials={three} />);
    await dragWithKeyboard(screen.getByRole("button", { name: "Drag to reorder Alpha" }), "ArrowDown");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/session has expired/)));
  });

  it("does not reorder when a row is dropped where it was", async () => {
    layOutRows();
    render(<TutorialList tutorials={three} />);
    await dragWithKeyboard(screen.getByRole("button", { name: "Drag to reorder Beta" }));
    expect(reorderTutorials).not.toHaveBeenCalled();
    expect(titles()).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("freezes the handles while a reorder is on its way", async () => {
    let answer: (value: unknown) => void = () => {};
    reorderTutorials.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    layOutRows();
    render(<TutorialList tutorials={three} />);
    await dragWithKeyboard(screen.getByRole("button", { name: "Drag to reorder Alpha" }), "ArrowDown");
    await waitFor(() => expect(screen.getByRole("button", { name: "Drag to reorder Beta" }).getAttribute("aria-disabled")).toBe("true"));
    await act(async () => answer({ ok: true, data: null }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Drag to reorder Beta" }).getAttribute("aria-disabled")).toBe("false"));
  });

  it("shows the empty state", () => {
    render(<TutorialList tutorials={[]} />);
    expect(screen.getByText("No tutorials yet.")).toBeTruthy();
  });
});

describe("a tutorial's actions", () => {
  const withText = { type: "doc" as const, content: [{ type: "paragraph", content: [{ type: "text", text: "Steps" }] }] };

  it("offers View on site only for a published tutorial that has page text", () => {
    render(
      <TutorialList
        tutorials={[
          tutorial({ id: "a", title: "With page", slug: "with-page", body: withText }),
          tutorial({ id: "b", title: "No page", slug: "no-page" }),
        ]}
      />
    );
    const view = screen.getByRole("link", { name: "View With page on site" });
    expect(view.getAttribute("href")).toBe("/community/tutorials/with-page");
    expect(view.getAttribute("target")).toBe("_blank");
    expect(screen.queryByRole("link", { name: "View No page on site" })).toBeNull();
  });

  it("has no Edit action and no menu, and the state button follows the row's state", () => {
    render(
      <TutorialList
        tutorials={[tutorial({ id: "a", title: "Live", slug: "live", state: "published" }), tutorial({ id: "b", title: "Hidden", slug: "hidden", state: "draft" })]}
      />
    );
    expect(screen.queryByRole("button", { name: /^Edit/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /^Edit/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Actions for/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Move to draft: Live" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Publish Live" })).toBeNull();
    expect(screen.getByRole("button", { name: "Publish Hidden" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Move to draft: Hidden" })).toBeNull();
    expect(screen.getByRole("button", { name: "Delete Live" })).toBeTruthy();
  });
});

describe("selecting rows", () => {
  const three = [
    tutorial({ id: "a", title: "Alpha", slug: "alpha", state: "published" }),
    tutorial({ id: "b", title: "Beta", slug: "beta", state: "draft" }),
    tutorial({ id: "c", title: "Gamma", slug: "gamma", state: "draft" }),
  ];
  // The header's, after the phone's select-all in the bar (the stylesheet that hides one of them is not loaded here).
  const all = () => screen.getAllByRole("checkbox", { name: "Select all tutorials" }).at(-1) as HTMLElement;
  const row = (title: string) => screen.getByRole("checkbox", { name: `Select ${title}` });

  it("has a select-all in the header that is indeterminate for some rows, and a checkbox per row", () => {
    render(<TutorialList tutorials={three} />);
    expect(all().getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByRole("region", { name: "Selected tutorials" })?.textContent).not.toMatch(/selected/);
    fireEvent.click(row("Alpha"));
    expect(all().getAttribute("aria-checked")).toBe("mixed");
    fireEvent.click(row("Beta"));
    fireEvent.click(row("Gamma"));
    expect(all().getAttribute("aria-checked")).toBe("true");
    // From all, one click clears.
    fireEvent.click(all());
    expect(three.map((t) => row(t.title).getAttribute("aria-checked"))).toEqual(["false", "false", "false"]);
  });

  it("shows a bar with the count and Clear selection once a row is ticked", () => {
    render(<TutorialList tutorials={three} />);
    fireEvent.click(row("Alpha"));
    fireEvent.click(row("Gamma"));
    const bar = screen.getByRole("region", { name: "Selected tutorials" });
    expect(within(bar).getByText("2 selected")).toBeTruthy();
    for (const name of ["Publish", "Move to draft", "Delete", "Clear selection"]) expect(within(bar).getByRole("button", { name })).toBeTruthy();
    fireEvent.click(within(bar).getByRole("button", { name: "Clear selection" }));
    expect(screen.queryByText("2 selected")).toBeNull();
  });

  it("selects every row from the header's checkbox, which a refresh then trims to the rows still listed", () => {
    const { rerender } = render(<TutorialList tutorials={three} />);
    fireEvent.click(all());
    expect(screen.getByText("3 selected")).toBeTruthy();
    rerender(<TutorialList tutorials={three.slice(0, 2)} />);
    expect(screen.getByText("2 selected")).toBeTruthy();
  });

  it("publishes the selected rows in one request, says so, clears them and refreshes", async () => {
    bulkContent.mockResolvedValue({ ok: true, data: { done: ["b", "c"], missing: [] } });
    render(<TutorialList tutorials={three} />);
    fireEvent.click(row("Beta"));
    fireEvent.click(row("Gamma"));
    fireEvent.click(within(screen.getByRole("region", { name: "Selected tutorials" })).getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(bulkContent).toHaveBeenCalledWith("tutorials", "publish", ["b", "c"]));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Published 2 tutorials."));
    expect(refresh).toHaveBeenCalled();
    expect(screen.queryByText("2 selected")).toBeNull();
  });

  it("moves the selected rows to draft", async () => {
    bulkContent.mockResolvedValue({ ok: true, data: { done: ["a"], missing: [] } });
    render(<TutorialList tutorials={three} />);
    fireEvent.click(row("Alpha"));
    fireEvent.click(screen.getByRole("button", { name: "Move to draft" }));
    await waitFor(() => expect(bulkContent).toHaveBeenCalledWith("tutorials", "draft", ["a"]));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Moved 1 tutorial to draft."));
  });

  it("names the rows it could not change and keeps them selected", async () => {
    bulkContent.mockResolvedValue({ ok: true, data: { done: ["b"], missing: ["c"] } });
    render(<TutorialList tutorials={three} />);
    fireEvent.click(all());
    fireEvent.click(within(screen.getByRole("region", { name: "Selected tutorials" })).getByRole("button", { name: "Publish" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Published 1 tutorial, but “Gamma” no longer exists. Reload the page.")
    );
    expect(row("Gamma").getAttribute("aria-checked")).toBe("true");
    expect(row("Beta").getAttribute("aria-checked")).toBe("false");
  });

  it("keeps everything selected when the whole request is refused", async () => {
    bulkContent.mockResolvedValue({ ok: false, reason: "error", message: "Nope." });
    render(<TutorialList tutorials={three} />);
    fireEvent.click(row("Beta"));
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Nope."));
    expect(row("Beta").getAttribute("aria-checked")).toBe("true");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("asks before it deletes, listing how many and the first names, then deletes them all", async () => {
    bulkContent.mockResolvedValue({ ok: true, data: { done: ["a", "b", "c"], missing: [] } });
    render(<TutorialList tutorials={three} />);
    fireEvent.click(all());
    fireEvent.click(within(screen.getByRole("region", { name: "Selected tutorials" })).getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Delete 3 tutorials?")).toBeTruthy();
    expect(within(dialog).getByText("“Alpha”, “Beta” and “Gamma”")).toBeTruthy();
    expect(bulkContent).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete 3 tutorials" }));
    await waitFor(() => expect(bulkContent).toHaveBeenCalledWith("tutorials", "delete", ["a", "b", "c"]));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("3 tutorials deleted."));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.queryByText("3 selected")).toBeNull();
  });

  it("leaves the selection alone when the delete is cancelled", async () => {
    render(<TutorialList tutorials={three} />);
    fireEvent.click(row("Beta"));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(bulkContent).not.toHaveBeenCalled();
    expect(row("Beta").getAttribute("aria-checked")).toBe("true");
  });

  it("keeps the dialog open with the reason when a delete is refused", async () => {
    bulkContent.mockResolvedValue({ ok: false, reason: "session_expired" });
    render(<TutorialList tutorials={three} />);
    fireEvent.click(row("Beta"));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete tutorial" }));
    expect(await within(dialog).findByText("Your session has expired. Sign in again.")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(row("Beta").getAttribute("aria-checked")).toBe("true");
  });
});

describe("a workshop's actions", () => {
  const items = [
    workshop({ id: "w1", title: "Live one", slug: "live-one", state: "published" }),
    workshop({ id: "w2", title: "Hidden one", slug: "hidden-one", state: "draft" }),
  ];

  it("has View on site, Move to draft and Delete for a published workshop, and no Edit", () => {
    render(<WorkshopList workshops={items} />);
    const view = screen.getByRole("link", { name: "View Live one on site" });
    expect(view.getAttribute("href")).toBe("/community/workshops/live-one");
    expect(view.getAttribute("target")).toBe("_blank");
    expect(screen.getByRole("button", { name: "Move to draft: Live one" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Publish Live one" })).toBeNull();
    expect(screen.getByRole("button", { name: "Delete Live one" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Edit/ })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Edit" })).toBeNull();
    // The title is the way into the editor.
    expect(screen.getByRole("link", { name: "Live one" }).getAttribute("href")).toBe("/admin/community/workshops/w1");
  });

  it("has Publish and no View on site for a draft", () => {
    render(<WorkshopList workshops={items} />);
    expect(screen.getByRole("button", { name: "Publish Hidden one" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "View Hidden one on site" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Move to draft: Hidden one" })).toBeNull();
  });

  it("holds the buttons of a row while a request for it is on its way", async () => {
    let answer: (value: unknown) => void = () => {};
    bulkContent.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    render(<WorkshopList workshops={items} />);
    fireEvent.click(screen.getByRole("button", { name: "Publish Hidden one" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Publish Hidden one" }).hasAttribute("disabled")).toBe(true));
    expect(screen.getByRole("button", { name: "Move to draft: Live one" }).hasAttribute("disabled")).toBe(true);
    await act(async () => answer({ ok: true, data: { done: ["w2"], missing: [] } }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Publish Hidden one" }).hasAttribute("disabled")).toBe(false));
  });

  it("publishes just that row", async () => {
    bulkContent.mockResolvedValue({ ok: true, data: { done: ["w2"], missing: [] } });
    render(<WorkshopList workshops={items} />);
    fireEvent.click(screen.getByRole("button", { name: "Publish Hidden one" }));
    await waitFor(() => expect(bulkContent).toHaveBeenCalledWith("workshops", "publish", ["w2"]));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Published 1 workshop."));
  });

  it("asks before it deletes that row, naming it", async () => {
    bulkContent.mockResolvedValue({ ok: true, data: { done: ["w1"], missing: [] } });
    render(<WorkshopList workshops={items} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Live one" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Delete this workshop?")).toBeTruthy();
    expect(within(dialog).getByText("“Live one”")).toBeTruthy();
    expect(bulkContent).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete workshop" }));
    await waitFor(() => expect(bulkContent).toHaveBeenCalledWith("workshops", "delete", ["w1"]));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Workshop deleted."));
  });

  it("treats a row that is already gone as deleted", async () => {
    bulkContent.mockResolvedValue({ ok: true, data: { done: [], missing: ["w1"] } });
    render(<WorkshopList workshops={items} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Live one" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete workshop" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Workshop deleted."));
  });
});

describe("pinning a workshop to the home page", () => {
  const items = [
    workshop({ id: "w1", title: "Live one", slug: "live-one", state: "published" }),
    workshop({ id: "w2", title: "Pinned one", slug: "pinned-one", state: "published" }),
    workshop({ id: "w3", title: "Hidden one", slug: "hidden-one", state: "draft" }),
  ];

  it("has a Pin button for a published workshop, an Unpin button for a pinned one, and none for a draft", () => {
    render(<WorkshopList workshops={items} pinned={["w2"]} />);
    expect(screen.getByRole("button", { name: "Pin Live one to the home page" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unpin Pinned one from the home page" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Hidden one (to|from) the home page/ })).toBeNull();
    expect(screen.getByText("Pinned to the home page")).toBeTruthy();
  });

  it("offers no pin button when the pins could not be read", () => {
    render(<WorkshopList workshops={items} pinned={null} />);
    expect(screen.queryByRole("button", { name: /the home page$/ })).toBeNull();
  });

  it("pins it at once, says so and refreshes", async () => {
    pinItem.mockResolvedValue({ ok: true, data: {} });
    render(<WorkshopList workshops={items} pinned={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Pin Live one to the home page" }));
    await waitFor(() => expect(pinItem).toHaveBeenCalledWith("workshop", "w1"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Pinned to the home page."));
    expect(refresh).toHaveBeenCalled();
  });

  it("unpins it at once", async () => {
    unpinItem.mockResolvedValue({ ok: true, data: {} });
    render(<WorkshopList workshops={items} pinned={["w2"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Unpin Pinned one from the home page" }));
    await waitFor(() => expect(unpinItem).toHaveBeenCalledWith("workshop", "w2"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Unpinned from the home page."));
  });

  it("says why when the backend refuses, and does not refresh", async () => {
    pinItem.mockResolvedValue({ ok: false, reason: "error", status: 409, message: "At most 12 items can be pinned. Unpin one first." });
    render(<WorkshopList workshops={items} pinned={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Pin Live one to the home page" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("At most 12 items can be pinned. Unpin one first."));
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("the audit log", () => {
  it("has a Content tab that filters by the content category", () => {
    render(<AuditLogTable entries={[]} activeCategory="content" basePath="/admin/audit" />);
    const tab = screen.getByRole("link", { name: "Content" });
    expect(tab.getAttribute("href")).toBe("/admin/audit?category=content");
    expect(tab.getAttribute("aria-current")).toBe("page");
  });
});
