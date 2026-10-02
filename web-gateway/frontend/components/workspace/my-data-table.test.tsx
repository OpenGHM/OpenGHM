import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

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

/** The table's rows (the header excluded); both the table and the stacked list are in the DOM. */
function tableRows() {
  return within(screen.getByRole("table")).getAllByRole("row").slice(1);
}
function stackedRows() {
  return within(screen.getByRole("list", { name: "Snapshots and inputs" })).getAllByRole("listitem");
}

describe("the table", () => {
  it("has the five columns", () => {
    render(<MyDataTable items={[SNAP]} />);
    expect(within(screen.getByRole("table")).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Name",
      "Type",
      "Visibility",
      "Coverage",
      "Published",
    ]);
  });

  it("shows one row per item, in the order given", () => {
    render(<MyDataTable items={[PRIVATE_INPUT, SNAP]} />);
    expect(tableRows()).toHaveLength(2);
    expect(within(tableRows()[0]).getByRole("link").textContent).toBe("Ancillary Data v1");
    expect(within(tableRows()[1]).getByRole("link").textContent).toBe("Global Storage Run");
  });

  it("links each title to its detail page, as the repository card does", () => {
    render(<MyDataTable items={[SNAP, PRIVATE_INPUT]} />);
    const [snap, input] = tableRows();
    expect(within(snap).getByRole("link", { name: "Global Storage Run" }).getAttribute("href")).toBe(
      "/repository/0123456789abcdef0123456789abcdef"
    );
    expect(within(input).getByRole("link", { name: "Ancillary Data v1" }).getAttribute("href")).toBe(
      "/repository/model-inputs/mi-1"
    );
  });

  it("shows the first 8 characters of the id, with an ellipsis, in mono", () => {
    render(<MyDataTable items={[SNAP]} />);
    const id = within(tableRows()[0]).getByText("01234567…");
    expect(id.className).toContain("font-mono");
    expect(id.className).toContain("text-muted-foreground");
    expect(screen.queryByText("0123456789abcdef0123456789abcdef")).toBeNull();
  });

  it("labels each row's type with the repository's outlined badge and its dot", () => {
    render(<MyDataTable items={[SNAP, PRIVATE_INPUT]} />);
    const [snap, input] = tableRows();
    const snapBadge = within(snap).getByText("Model Snapshot");
    expect(snapBadge.className).toContain("border-border");
    expect(snapBadge.querySelector(".bg-primary")).not.toBeNull();
    expect(within(input).getByText("Model Input").querySelector(".bg-compute")).not.toBeNull();
  });

  it("shows each row's visibility, Public with a globe and Private with a lock", () => {
    render(<MyDataTable items={[SNAP, PRIVATE_INPUT]} />);
    const [snap, input] = tableRows();
    const pub = within(snap).getByText("Public");
    const priv = within(input).getByText("Private");
    expect(pub.querySelector("svg.lucide-globe")).not.toBeNull();
    expect(priv.querySelector("svg.lucide-lock")).not.toBeNull();
    // Neutral: the same slate styling for both, no colour coding.
    expect(pub.className).toBe(priv.className);
    expect(pub.className).toContain("slate");
  });

  it("shows the coverage the way a repository card does, and the date published", () => {
    render(<MyDataTable items={[SNAP, PRIVATE_INPUT]} />);
    const [snap, input] = tableRows();
    expect(within(snap).getByText("2000–2009 · 5 arc-min").className).toContain("font-mono");
    expect(within(snap).getByText("Mar 14, 2026")).toBeTruthy();
    expect(within(input).getByText("Climatological · 5 arc-min, 30 arc-sec")).toBeTruthy();
    expect(within(input).getByText("Nov 2, 2025")).toBeTruthy();
  });

  it("hides the secondary columns on a narrow screen and keeps the name, type and visibility", () => {
    render(<MyDataTable items={[SNAP]} />);
    const headers = within(screen.getByRole("table")).getAllByRole("columnheader");
    expect(headers.map((h) => h.className.includes("hidden md:table-cell"))).toEqual([
      false,
      false,
      false,
      true,
      true,
    ]);
  });

  it("stacks the rows below sm: title, badges, coverage, short id and date", () => {
    render(<MyDataTable items={[SNAP, PRIVATE_INPUT]} />);
    expect(screen.getByRole("table").closest("div.hidden")?.className).toContain("sm:block");
    expect(screen.getByRole("list", { name: "Snapshots and inputs" }).className).toContain("sm:hidden");
    const [snap] = stackedRows();
    expect(within(snap).getByRole("link", { name: "Global Storage Run" }).getAttribute("href")).toBe(
      "/repository/0123456789abcdef0123456789abcdef"
    );
    expect(within(snap).getByText("Model Snapshot")).toBeTruthy();
    expect(within(snap).getByText("Public")).toBeTruthy();
    expect(within(snap).getByText("2000–2009 · 5 arc-min")).toBeTruthy();
    expect(within(snap).getByText("01234567…")).toBeTruthy();
  });

  it("has no row actions: no menu, no buttons", () => {
    render(<MyDataTable items={[SNAP, PRIVATE_INPUT]} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByText("Actions")).toBeNull();
  });
});

describe("the kind tabs", () => {
  const ITEMS = [SNAP, PRIVATE_INPUT, SNAP2];

  function tab(name: RegExp) {
    return within(screen.getByRole("navigation", { name: "Filter by type" })).getByRole("link", { name });
  }
  const titles = () => tableRows().map((r) => within(r).getAllByRole("link")[0].textContent);

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
    expect(stackedRows()).toHaveLength(2);
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
    expect(screen.queryByRole("table")).toBeNull();
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
        "When a simulation finishes, you will be able to publish it as a model snapshot from its page."
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

  it("is a table's shape: the tab bar and five rows", () => {
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
    expect(tableRows()).toHaveLength(2);
  });

  it("shows the empty state for an empty answer", async () => {
    fetchMine.mockResolvedValue({ items: [] });
    render(await MyDataSection({ here: "/workspace/data" }));
    expect(screen.getByText("Nothing published yet")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
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
