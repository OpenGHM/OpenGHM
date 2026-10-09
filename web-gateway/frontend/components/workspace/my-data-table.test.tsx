import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const { fetchMine, redirectToSignIn, search } = vi.hoisted(() => ({
  fetchMine: vi.fn(),
  // The real one is `never`: it throws Next's redirect.
  redirectToSignIn: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
  search: { params: new URLSearchParams() },
}));
vi.mock("@/lib/repository/actions", () => ({ fetchMine }));
vi.mock("@/lib/auth-guard", () => ({
  redirectToSignIn,
  isUnauthorizedError: (e: unknown) =>
    (e as { response?: { status?: number } })?.response?.status === 401,
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => search.params,
  usePathname: () => "/workspace/data",
}));

import { modelInputItem, mineItem, snapshotItem } from "@/components/repository/catalogue.fixtures";
import { MyDataTable } from "./my-data-table";
import { MyDataEmpty, MyDataLoadError, MyDataSkeleton } from "./my-data-states";
import { MyDataSection } from "./my-data-section";

afterEach(cleanup);
beforeEach(() => {
  fetchMine.mockReset();
  redirectToSignIn.mockClear();
  search.params = new URLSearchParams();
});

const SNAP = mineItem(snapshotItem({ id: "0123456789abcdef0123456789abcdef" }));
const PRIVATE_INPUT = mineItem(modelInputItem(), { visibility: "private" });
const SNAP2 = mineItem(snapshotItem({ id: "snap-2", about: { ...snapshotItem().about, name: "Second Run" } }));

/** The rows of the list (the header is not one). */
function rows() {
  return within(screen.getByRole("list", { name: "Snapshots and inputs" })).getAllByRole("listitem");
}

describe("the list", () => {
  it("is one card of rows, not a table, with a small header for the columns", () => {
    render(<MyDataTable items={[SNAP]} />);
    expect(screen.queryByRole("table")).toBeNull();
    const card = screen.getByRole("list", { name: "Snapshots and inputs" }).parentElement!;
    expect(card.className).toContain("rounded-xl");
    expect(card.className).toContain("bg-card");
    expect(within(card).getByText("Visibility").parentElement?.getAttribute("aria-hidden")).toBe("true");
  });

  it("shows one row per item, in the order given, and no 'Sorted by' note", () => {
    render(<MyDataTable items={[PRIVATE_INPUT, SNAP]} />);
    expect(rows()).toHaveLength(2);
    expect(within(rows()[0]).getByRole("link").textContent).toBe("Ancillary Data v1");
    expect(within(rows()[1]).getByRole("link").textContent).toBe("Global Storage Run");
    expect(screen.queryByText(/Sorted by/)).toBeNull();
  });

  it("makes each row one link to its detail page, as the repository card does", () => {
    render(<MyDataTable items={[SNAP, PRIVATE_INPUT]} />);
    const [snap, input] = rows();
    const link = within(snap).getByRole("link", { name: "Global Storage Run" });
    expect(link.getAttribute("href")).toBe("/repository/0123456789abcdef0123456789abcdef");
    expect(link.className).toContain("after:inset-0");
    expect(snap.className).toContain("relative");
    expect(within(input).getByRole("link", { name: "Ancillary Data v1" }).getAttribute("href")).toBe(
      "/repository/model-inputs/mi-1"
    );
    expect(within(snap).getAllByRole("link")).toHaveLength(1);
  });

  it("shows the title in one line, cut with an ellipsis, with the whole title on hover", () => {
    render(<MyDataTable items={[SNAP]} />);
    const link = within(rows()[0]).getByRole("link", { name: "Global Storage Run" });
    expect(link.getAttribute("title")).toBe("Global Storage Run");
    expect(link.className).toContain("truncate");
    expect(link.className).not.toContain("line-clamp");
  });

  it("puts the first 8 characters of the id and the coverage in one mono line under the title", () => {
    render(<MyDataTable items={[SNAP, PRIVATE_INPUT]} />);
    const [snap, input] = rows();
    const line = within(snap).getByText("01234567… · 2000–2009 · 5 arc-min");
    expect(line.className).toContain("font-mono");
    expect(line.className).toContain("text-muted-foreground");
    expect(screen.queryByText("0123456789abcdef0123456789abcdef")).toBeNull();
    expect(within(input).getByText(/Climatological · 5 arc-min, 30 arc-sec/).className).toContain("font-mono");
  });

  it("labels each row's type with a dot in the kind's hue and a word, with no box", () => {
    render(<MyDataTable items={[SNAP, PRIVATE_INPUT]} />);
    const [snap, input] = rows();
    const snapKind = within(snap).getByText("Model Snapshot");
    expect(snapKind.className).not.toContain("border");
    expect(snapKind.querySelector(".bg-primary")).not.toBeNull();
    expect(within(input).getByText("Model Input").querySelector(".bg-compute")).not.toBeNull();
  });

  it("shows each row's visibility as quiet text, Public with a globe and Private with a lock", () => {
    render(<MyDataTable items={[SNAP, PRIVATE_INPUT]} />);
    const [snap, input] = rows();
    const pub = within(snap).getByText("Public");
    const priv = within(input).getByText("Private");
    expect(pub.querySelector("svg.lucide-globe")).not.toBeNull();
    expect(priv.querySelector("svg.lucide-lock")).not.toBeNull();
    // Neutral: the same styling for both, no colour coding and no box.
    expect(pub.className).toBe(priv.className);
    expect(pub.className).not.toContain("border");
  });

  it("shows the date published", () => {
    render(<MyDataTable items={[SNAP, PRIVATE_INPUT]} />);
    const [snap, input] = rows();
    expect(within(snap).getByText("Mar 14, 2026")).toBeTruthy();
    expect(within(input).getByText("Nov 2, 2025")).toBeTruthy();
  });

  it("is a grid that stacks below sm, with the same markup, and joins Published at md", () => {
    render(<MyDataTable items={[SNAP]} />);
    const row = rows()[0];
    expect(row.className).toContain("grid-cols-1");
    expect(row.className).toContain("sm:grid-cols-[");
    expect(row.className).toContain("md:grid-cols-[");
  });

  it("has no row actions: no menu, no buttons", () => {
    render(<MyDataTable items={[SNAP, PRIVATE_INPUT]} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByText("Actions")).toBeNull();
  });
});

describe("the search", () => {
  const type = (text: string) =>
    fireEvent.change(screen.getByRole("searchbox", { name: "Search snapshots and inputs by name" }), {
      target: { value: text },
    });

  it("filters the rows by title as you type, and Clear search brings them back", () => {
    render(<MyDataTable items={[SNAP, PRIVATE_INPUT]} />);
    type("ancillary");
    expect(rows().map((r) => within(r).getByRole("link").textContent)).toEqual(["Ancillary Data v1"]);
    type("nothing like it");
    expect(screen.queryByRole("list", { name: "Snapshots and inputs" })).toBeNull();
    expect(screen.getByText(/Nothing matches/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Clear search" })[0]);
    expect(rows()).toHaveLength(2);
  });

  it("finds a row by the start of its id", () => {
    render(<MyDataTable items={[SNAP, PRIVATE_INPUT]} />);
    type("01234567");
    expect(rows()).toHaveLength(1);
  });

  it("is not offered when the selected kind has no rows", () => {
    search.params = new URLSearchParams("kind=model-input");
    render(<MyDataTable items={[SNAP]} />);
    expect(screen.queryByRole("searchbox")).toBeNull();
  });
});

describe("the kind tabs", () => {
  const ITEMS = [SNAP, PRIVATE_INPUT, SNAP2];

  function tab(name: RegExp) {
    return within(screen.getByRole("navigation", { name: "Filter by type" })).getByRole("link", { name });
  }
  const titles = () => rows().map((r) => within(r).getAllByRole("link")[0].textContent);

  it("count each kind and all", () => {
    render(<MyDataTable items={ITEMS} />);
    expect(tab(/^All/).textContent).toBe("All3");
    expect(tab(/^Model Snapshots/).textContent).toBe("Model Snapshots2");
    expect(tab(/^Model Inputs/).textContent).toBe("Model Inputs1");
  });

  it("show everything with no ?kind, and mark All", () => {
    render(<MyDataTable items={ITEMS} />);
    expect(titles()).toEqual(["Global Storage Run", "Ancillary Data v1", "Second Run"]);
    expect(tab(/^All/).getAttribute("aria-current")).toBe("page");
  });

  it("read ?kind=snapshot from the URL: only snapshots, and that tab marked", () => {
    search.params = new URLSearchParams("kind=snapshot");
    render(<MyDataTable items={ITEMS} />);
    expect(titles()).toEqual(["Global Storage Run", "Second Run"]);
    expect(tab(/^Model Snapshots/).getAttribute("aria-current")).toBe("page");
    expect(tab(/^All/).getAttribute("aria-current")).toBeNull();
    expect(rows()).toHaveLength(2);
  });

  it("read ?kind=model-input: only model inputs", () => {
    search.params = new URLSearchParams("kind=model-input");
    render(<MyDataTable items={ITEMS} />);
    expect(titles()).toEqual(["Ancillary Data v1"]);
    expect(tab(/^Model Inputs/).getAttribute("aria-current")).toBe("page");
  });

  it("take an unknown ?kind for All", () => {
    search.params = new URLSearchParams("kind=nonsense");
    render(<MyDataTable items={ITEMS} />);
    expect(titles()).toHaveLength(3);
    expect(tab(/^All/).getAttribute("aria-current")).toBe("page");
  });

  it("say so, and offer all, when the selected kind has no rows", () => {
    search.params = new URLSearchParams("kind=model-input");
    render(<MyDataTable items={[SNAP]} />);
    expect(screen.queryByRole("list", { name: "Snapshots and inputs" })).toBeNull();
    expect(screen.getByText("No model inputs yet")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Show all" }).getAttribute("href")).toBe("/workspace/data");
    // The tabs stay, with their counts, to switch from.
    expect(tab(/^Model Inputs/).textContent).toBe("Model Inputs0");
  });
});

describe("the empty state", () => {
  it("says nothing is published yet, with no button or link", () => {
    render(<MyDataEmpty />);
    expect(screen.getByText("Nothing published yet")).toBeTruthy();
    expect(
      screen.getByText(
        "When a snapshot draft's simulation finishes, you will be able to publish it as a model snapshot from its page."
      )
    ).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("the loading state", () => {
  it("is announced once, as busy", () => {
    render(<MyDataSkeleton />);
    expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");
  });

  it("stays out of sight for the first 300 ms", () => {
    render(<MyDataSkeleton />);
    expect(screen.getByRole("status").className).toContain("reveal-delayed");
  });

  it("is the list's shape: the toolbar, the header and five rows", () => {
    const { container } = render(<MyDataSkeleton />);
    expect(container.querySelectorAll(".divide-y > div")).toHaveLength(5);
  });
});

describe("the error state", () => {
  it("says so and offers the page again", () => {
    render(<MyDataLoadError retryHref="/workspace/data" />);
    expect(screen.getByRole("alert").textContent).toContain("Couldn't load what you published.");
    expect(screen.getByRole("link", { name: "Try again" }).getAttribute("href")).toBe("/workspace/data");
  });
});

describe("the section", () => {
  it("lists what the backend returned", async () => {
    fetchMine.mockResolvedValue({ items: [SNAP, PRIVATE_INPUT] });
    render(await MyDataSection({ here: "/workspace/data" }));
    expect(rows()).toHaveLength(2);
  });

  it("shows the empty state for an empty answer", async () => {
    fetchMine.mockResolvedValue({ items: [] });
    render(await MyDataSection({ here: "/workspace/data" }));
    expect(screen.getByText("Nothing published yet")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Snapshots and inputs" })).toBeNull();
  });

  it("shows the error state, not an empty list, when the backend fails", async () => {
    fetchMine.mockRejectedValue(new Error("Network Error"));
    render(await MyDataSection({ here: "/workspace/data" }));
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByText("Nothing published yet")).toBeNull();
  });

  it("sends a 401 to sign in, and back here afterwards", async () => {
    fetchMine.mockRejectedValue({ response: { status: 401 } });
    await expect(MyDataSection({ here: "/workspace/data" })).rejects.toThrow("redirect:/workspace/data");
    expect(redirectToSignIn).toHaveBeenCalledWith("/workspace/data");
  });
});

describe("a row with a short name", () => {
  const FULL = "A very long paper title: [Wyoming] [2000-2009]";
  const SHORT = mineItem(
    snapshotItem({ id: "short-1", about: { ...snapshotItem().about, name: FULL, shortName: "Wyoming 2000s" } })
  );

  it("is titled by it, with the full name on hover, and still found by either", () => {
    render(<MyDataTable items={[SHORT, SNAP2]} />);
    const link = screen.getByRole("link", { name: "Wyoming 2000s" });
    expect(link.getAttribute("title")).toBe(FULL);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "wyoming 2000s" } });
    expect(rows()).toHaveLength(1);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "paper title" } });
    expect(rows()).toHaveLength(1);
    expect(within(rows()[0]).getByRole("link", { name: "Wyoming 2000s" })).toBeTruthy();
  });
});
