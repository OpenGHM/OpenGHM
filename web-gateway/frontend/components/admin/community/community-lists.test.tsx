import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const { reorderTutorials, bulkContent, toast, refresh } = vi.hoisted(() => ({
  reorderTutorials: vi.fn(),
  bulkContent: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  refresh: vi.fn(),
}));
vi.mock("@/lib/community/admin-actions", () => ({ reorderTutorials, bulkContent, bulkDeleteFiles: vi.fn() }));
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

describe("a tutorial's menu", () => {
  const open = async (title: string) => {
    const trigger = screen.getByRole("button", { name: `Actions for ${title}` });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    return screen.findByRole("menu");
  };
  const withText = { type: "doc" as const, content: [{ type: "paragraph", content: [{ type: "text", text: "Steps" }] }] };

  it("offers View on site only for a published tutorial that has page text", async () => {
    render(
      <TutorialList
        tutorials={[
          tutorial({ id: "a", title: "With page", slug: "with-page", body: withText }),
          tutorial({ id: "b", title: "No page", slug: "no-page" }),
        ]}
      />
    );
    const menu = await open("With page");
    expect(within(menu).getByRole("menuitem", { name: "View on site" }).getAttribute("href")).toBe("/community/tutorials/with-page");
    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(within(await open("No page")).queryByRole("menuitem", { name: "View on site" })).toBeNull();
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

describe("a row's menu", () => {
  const items = [
    workshop({ id: "w1", title: "Live one", slug: "live-one", state: "published" }),
    workshop({ id: "w2", title: "Hidden one", slug: "hidden-one", state: "draft" }),
  ];
  const open = async (title: string) => {
    const trigger = screen.getByRole("button", { name: `Actions for ${title}` });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    return screen.findByRole("menu");
  };

  it("has Edit, View on site, Move to draft and Delete for a published workshop", async () => {
    render(<WorkshopList workshops={items} />);
    const menu = await open("Live one");
    expect(within(menu).getByRole("menuitem", { name: "Edit" }).getAttribute("href")).toBe("/admin/community/workshops/w1");
    const view = within(menu).getByRole("menuitem", { name: "View on site" });
    expect(view.getAttribute("href")).toBe("/community/workshops/live-one");
    expect(view.getAttribute("target")).toBe("_blank");
    expect(within(menu).getByRole("menuitem", { name: "Move to draft" })).toBeTruthy();
    expect(within(menu).queryByRole("menuitem", { name: "Publish" })).toBeNull();
    expect(within(menu).getByRole("menuitem", { name: "Delete" })).toBeTruthy();
  });

  it("has Publish and no View on site for a draft", async () => {
    render(<WorkshopList workshops={items} />);
    const menu = await open("Hidden one");
    expect(within(menu).getByRole("menuitem", { name: "Publish" })).toBeTruthy();
    expect(within(menu).queryByRole("menuitem", { name: "View on site" })).toBeNull();
    expect(within(menu).queryByRole("menuitem", { name: "Move to draft" })).toBeNull();
  });

  it("publishes just that row", async () => {
    bulkContent.mockResolvedValue({ ok: true, data: { done: ["w2"], missing: [] } });
    render(<WorkshopList workshops={items} />);
    fireEvent.click(within(await open("Hidden one")).getByRole("menuitem", { name: "Publish" }));
    await waitFor(() => expect(bulkContent).toHaveBeenCalledWith("workshops", "publish", ["w2"]));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Published 1 workshop."));
  });

  it("asks before it deletes that row, naming it", async () => {
    bulkContent.mockResolvedValue({ ok: true, data: { done: ["w1"], missing: [] } });
    render(<WorkshopList workshops={items} />);
    fireEvent.click(within(await open("Live one")).getByRole("menuitem", { name: "Delete" }));
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
    fireEvent.click(within(await open("Live one")).getByRole("menuitem", { name: "Delete" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete workshop" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Workshop deleted."));
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
