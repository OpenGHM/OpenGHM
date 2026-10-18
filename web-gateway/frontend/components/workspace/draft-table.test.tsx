import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Job } from "@/lib/jobs/types";
import { fakePublish } from "@/lib/workspace/fixtures";

vi.mock("@/lib/jobs/actions", () => ({ cancelJob: vi.fn(), deleteDraft: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/workspace",
}));

import {
  DraftSearchInput,
  DraftSearchProvider,
} from "@/components/workspace/draft-search";
import { DraftTable } from "@/components/workspace/draft-table";

afterEach(cleanup);

function job(id: string, status: Job["status"], over: Partial<Job> = {}): Job {
  return {
    id,
    sim_id: `sim-${id}`,
    dataset_id: "ds-1",
    dataset_title: "Dataset one",
    slug: null,
    about: { name: `Run ${id}` },
    status,
    created_at: "2026-09-30T10:00:00Z",
    updated_at: "2026-09-30T12:00:00Z",
    cancel_requested_at: null,
    work_dir: null,
    remote_job_dir: null,
    files: null,
    ...over,
  } as Job;
}

const items = () => within(screen.getByRole("list", { name: "Snapshot drafts" })).getAllByRole("listitem");

describe("the snapshot draft list", () => {
  it("is a stack of row cards under a mono header, not a table", () => {
    render(<DraftTable jobs={[job("a", "RUNNING")]} />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(items()).toHaveLength(1);
    const list = screen.getByRole("list", { name: "Snapshot drafts" });
    expect(list.className).toContain("flex-col");
    // Each row is a white rounded card of its own, not a line in one card.
    expect(items()[0].className).toContain("rounded-[18px]");
    expect(items()[0].className).toContain("bg-card");
    // The header is for the eye: every row names its own fields for a screen reader.
    const header = within(list.parentElement!).getByText("Name").parentElement!;
    expect(header.getAttribute("aria-hidden")).toBe("true");
    expect(header.className).toContain("font-mono");
    expect([...header.children].map((c) => c.textContent)).toEqual(["Name", "Run period", "Status", "Updated", ""]);
  });

  it("puts a glyph tile in the status's hue at the start of each row", () => {
    render(<DraftTable jobs={[job("a", "COMPLETED"), job("b", "FAILED"), job("c", "DRAFT")]} />);
    const tiles = items().map((li) => li.querySelector("svg")!.parentElement!);
    expect(tiles.map((t) => t.className.match(/text-status-\w+/)?.[0])).toEqual([
      "text-status-completed",
      "text-status-failed",
      "text-status-draft",
    ]);
    for (const t of tiles) expect(t.getAttribute("aria-hidden")).toBe("true");
  });

  it("makes the whole row a link: the name's link is stretched over it", () => {
    render(<DraftTable jobs={[job("a", "COMPLETED")]} />);
    const row = items()[0];
    const link = within(row).getByRole("link", { name: "Run a" });
    expect(link.getAttribute("href")).toBe("/workspace/a");
    expect(link.className).toContain("after:absolute");
    expect(link.className).toContain("after:inset-0");
    expect(row.className).toContain("relative");
    expect(row.className).toContain("hover:shadow-lift");
    // One link per row, and it is not the snapshot: the page says that.
    expect(within(row).getAllByRole("link")).toHaveLength(1);
  });

  it("puts the title of the snapshot under the name, in one line with the whole title on hover", () => {
    const title = "WBM v1.0.0 Global_tracking snapshot draft for 'Water balance model (WBM) v.1.0.0': [Global] [2000-2009]";
    render(<DraftTable jobs={[job("a", "COMPLETED", { dataset_title: title })]} />);
    // The version is the chip's; the title keeps what is left of it, and hangs whole on hover.
    const line = within(items()[0]).getByText(title.replace("v1.0.0 ", ""));
    expect(line.getAttribute("title")).toBe(title);
    expect(line.className).toContain("truncate");
    expect(line.className).not.toContain("line-clamp");
    expect(line.parentElement?.className).toContain("text-muted-foreground");
  });

  it("shows the snapshot's version as a small mono chip before its title, and none when the title has no version", () => {
    render(<DraftTable jobs={[job("a", "COMPLETED", { dataset_title: "WBM v2.0.0 CONUS tutorial" }), job("b", "COMPLETED")]} />);
    const chip = within(items()[0]).getByText("v2.0.0");
    expect(chip.className).toContain("font-mono");
    expect(chip.nextElementSibling?.textContent).toBe("WBM CONUS tutorial");
    expect(within(items()[1]).queryByText(/^v\d/)).toBeNull();
  });

  it("keeps a long draft name to one line and puts the whole name on hover", () => {
    const name = "A draft named like a paper title: ".repeat(8).trim();
    render(<DraftTable jobs={[job("a", "COMPLETED", { about: { name } })]} />);
    const link = within(items()[0]).getByRole("link", { name });
    expect(link.getAttribute("title")).toBe(name);
    expect(link.className).toContain("truncate");
    expect(link.className).toContain("min-w-0");
  });

  it("makes up no name for the snapshot: nothing but its title and the run note is there", () => {
    render(<DraftTable jobs={[job("a", "COMPLETED")]} />);
    expect(items()[0].textContent).not.toMatch(/WBM \d|Global|Regional/);
  });

  it("says the run period in its own mono column, one year as that year, in the one format", () => {
    const range = { temporal_range_start: "2000-01-01", temporal_range_end: "2001-12-31" } as Job["parameters"];
    const year = { temporal_range_start: "2000-01-01", temporal_range_end: "2000-12-31" } as Job["parameters"];
    render(<DraftTable jobs={[job("a", "COMPLETED", { parameters: range }), job("b", "FAILED", { parameters: year })]} />);
    const whole = within(items()[0]).getByText("2000–2001");
    expect(whole.className).toContain("font-mono");
    expect(within(items()[0]).getByText("Run period", { exact: false }).className).toContain("sr-only");
    expect(within(items()[1]).getByText("2000").className).toContain("font-mono");
    expect(items()[1].textContent).not.toMatch(/Run 2000/);
  });

  it("shows a dash for a draft with no run period yet", () => {
    render(<DraftTable jobs={[job("a", "DRAFT")]} />);
    expect(within(items()[0]).getByText("—")).toBeTruthy();
  });

  it("does not print a Model Snapshot badge on every row", () => {
    render(<DraftTable jobs={[job("a", "COMPLETED"), job("b", "FAILED")]} />);
    expect(screen.queryByText("Model Snapshot")).toBeNull();
  });

  it("keeps the row, with the title and no run note, for a job with no note", () => {
    render(<DraftTable jobs={[job("z", "COMPLETED")]} />);
    expect(within(items()[0]).getByRole("link", { name: "Run z" })).toBeTruthy();
    expect(within(items()[0]).getByText("Dataset one")).toBeTruthy();
    expect(within(items()[0]).queryByText(/Run 2/)).toBeNull();
  });

  it("shows the status as a tinted pill with a dot, in its colour, not as a bordered badge", () => {
    render(<DraftTable jobs={[job("a", "FAILED")]} />);
    const word = within(items()[0]).getByText("Failed");
    expect(word.className).toContain("text-status-failed");
    expect(word.className).toContain("bg-status-failed/10");
    expect(word.className).toContain("rounded-full");
    expect(word.className).not.toContain("border");
    expect(word.querySelector(".bg-current")).not.toBeNull();
  });

  it("prints the update time as a TimeStamp with its absolute time on hover", () => {
    render(<DraftTable jobs={[job("a", "RUNNING")]} />);
    const time = items()[0].querySelector("time");
    expect(time?.getAttribute("datetime")).toBe("2026-09-30T12:00:00Z");
    expect(time?.getAttribute("title")).toBeTruthy();
  });

  it("falls back to the creation time for a job that has never been updated", () => {
    render(<DraftTable jobs={[job("a", "DRAFT", { updated_at: null })]} />);
    expect(items()[0].querySelector("time")?.getAttribute("datetime")).toBe("2026-09-30T10:00:00Z");
  });

  it("stacks on a phone with the same markup: one list, no second copy and no table", () => {
    render(<DraftTable jobs={[job("a", "RUNNING"), job("b", "DRAFT")]} />);
    expect(screen.getAllByRole("list", { name: "Snapshot drafts" })).toHaveLength(1);
    // Name and meta, then status and time, with Delete beside them; from sm up they are columns.
    expect(items()[0].className).toContain("lg:grid-cols-[");
    expect(items()[0].className).toContain("grid-cols-[minmax(0,1fr)_auto]");
  });

  it("names an unnamed draft by its snapshot's short title and run period, with its run id apart and muted", () => {
    render(
      <DraftTable
        jobs={[
          job("0123456789abcdef", "COMPLETED", {
            about: null,
            slug: null,
            sim_id: "sim-20261002-6b5577",
            dataset_title: "WBM v2.0.0 CONUS tutorial simulation, 2000–2001",
            parameters: { temporal_range_start: "2000-01-01", temporal_range_end: "2000-12-31" } as Job["parameters"],
          }),
        ]}
      />
    );
    const row = items()[0];
    expect(within(row).getByRole("link", { name: "WBM CONUS tutorial simulation · 2000" })).toBeTruthy();
    const id = within(row).getByText("sim-20261002-6b5577");
    expect(id.className).toContain("font-mono");
    expect(id.className).toContain("text-muted-foreground");
  });

  it("names a draft that was never submitted the same way, with the start of its own id apart", () => {
    render(<DraftTable jobs={[job("0123456789abcdef", "DRAFT", { about: null, slug: null, sim_id: "" })]} />);
    const row = items()[0];
    expect(within(row).getByRole("link", { name: "Dataset one" })).toBeTruthy();
    expect(within(row).getByText("01234567").className).toContain("font-mono");
  });

  it("says Untitled draft only when there is no snapshot title to name it by", () => {
    render(<DraftTable jobs={[job("0123456789abcdef", "DRAFT", { about: null, slug: null, sim_id: "", dataset_title: "" })]} />);
    const row = items()[0];
    expect(within(row).getByRole("link", { name: "Untitled draft" })).toBeTruthy();
    expect(within(row).getByRole("button", { name: "Delete snapshot draft Untitled (01234567)" })).toBeTruthy();
  });

  it("names an unnamed job by its slug first, and finds it by its run id too", () => {
    render(
      <DraftSearchProvider>
        <DraftSearchInput />
        <DraftTable jobs={[job("a", "DRAFT", { about: null, slug: "my-slug" }), job("b", "DRAFT", { about: null })]} />
      </DraftSearchProvider>
    );
    expect(screen.getByRole("link", { name: "my-slug" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Dataset one" })).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "sim-b" } });
    expect(items()).toHaveLength(1);
  });

  it("offers a visible Delete on a draft and an ended job, never on an active one, and no menu", () => {
    render(
      <DraftTable
        jobs={[job("a", "RUNNING"), job("b", "DRAFT"), job("c", "FAILED"), job("d", "COMPLETING")]}
       
      />
    );
    expect(screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Delete snapshot draft Run b",
      "Delete snapshot draft Run c",
    ]);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("keeps Delete above the row's link, muted until hover or focus", () => {
    render(<DraftTable jobs={[job("a", "COMPLETED")]} />);
    const button = screen.getByRole("button", { name: "Delete snapshot draft Run a" });
    expect(button.className).toContain("z-10");
    expect(button.className).toContain("text-muted-foreground");
    expect(button.className).toContain("hover:text-destructive");
    expect(button.className).toContain("focus-visible:text-destructive");
  });

  it("opens the delete confirmation from a row's button without navigating", () => {
    render(<DraftTable jobs={[job("a", "COMPLETED")]} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete snapshot draft Run a" }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(screen.getByText("Delete this snapshot draft?")).toBeTruthy();
  });
});

describe("the list's search", () => {
  function setup(jobs: Job[], moreThanOnePage = false) {
    return render(
      <DraftSearchProvider>
        <DraftSearchInput />
        <DraftTable jobs={jobs} moreThanOnePage={moreThanOnePage} />
      </DraftSearchProvider>
    );
  }
  const type = (text: string) =>
    fireEvent.change(screen.getByRole("searchbox", { name: "Search snapshot drafts by name" }), { target: { value: text } });

  it("filters the loaded rows by name as you type, in any case", () => {
    setup([job("a", "COMPLETED", { about: { name: "CONUS tutorial" } }), job("b", "FAILED", { about: { name: "Global run" } })]);
    expect(items()).toHaveLength(2);
    type("conus");
    expect(items().map((li) => within(li).getAllByRole("link")[0].textContent)).toEqual(["CONUS tutorial"]);
    type("");
    expect(items()).toHaveLength(2);
  });

  it("says nothing matches, and Clear search brings the rows back", () => {
    setup([job("a", "COMPLETED")]);
    type("zzz");
    expect(screen.getByText(/No snapshot draft matches/)).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Snapshot drafts" })).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Clear search" })[0]);
    expect(items()).toHaveLength(1);
  });

  it("says it looked only at this page when the list has more pages", () => {
    setup([job("a", "COMPLETED")], true);
    type("zzz");
    expect(screen.getByText("Only the snapshot drafts on this page were searched.")).toBeTruthy();
  });

  it("clears on Escape", () => {
    setup([job("a", "COMPLETED")]);
    type("zzz");
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Escape" });
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
    expect(items()).toHaveLength(1);
  });

  it("is left alone when the table is rendered without a search box", () => {
    render(<DraftTable jobs={[job("a", "COMPLETED")]} />);
    expect(items()).toHaveLength(1);
  });
});

describe("a published snapshot draft in the list", () => {
  const ID = "9f2c41d07be6a35c8e10d4f7a2b96c3e5d08a1f47c6b29e3d5a07b8c1e4f6a92";

  it("reads Published, linking to its snapshot, above the row's own link", () => {
    render(<DraftTable jobs={[job("a", "COMPLETED", { publish: fakePublish("published") })]} />);
    const row = items()[0];
    const published = within(row).getByRole("link", { name: "Published" });
    expect(published.getAttribute("href")).toBe(`/repository/${ID}`);
    expect(published.className).toContain("relative");
    expect(published.className).toContain("z-10");
    // The row still opens the snapshot draft, and Completed is no longer its status.
    expect(within(row).getByRole("link", { name: "Run a" }).getAttribute("href")).toBe("/workspace/a");
    expect(within(row).queryByText("Completed")).toBeNull();
  });

  it("reads Publishing, with no link, while its publish runs", () => {
    render(<DraftTable jobs={[job("a", "COMPLETED", { publish: fakePublish("publishing") })]} />);
    const row = items()[0];
    expect(within(row).getByText("Publishing")).toBeTruthy();
    expect(within(row).getAllByRole("link")).toHaveLength(1);
  });

  it("reads Completed for a draft whose publish failed, and for one that never had one", () => {
    render(
      <DraftTable
        jobs={[
          job("a", "COMPLETED", { publish: fakePublish("publish_job_failed") }),
          job("b", "COMPLETED", { publish: null }),
          job("c", "COMPLETED"),
        ]}
       
      />
    );
    for (const row of items()) {
      expect(within(row).getByText("Completed")).toBeTruthy();
      expect(within(row).queryByText("Published")).toBeNull();
    }
  });
});
