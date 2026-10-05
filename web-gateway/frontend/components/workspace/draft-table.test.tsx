import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Job } from "@/lib/jobs/types";

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

const NOTES = { b: "Run 2000–2005" };

const items = () => within(screen.getByRole("list", { name: "Snapshot drafts" })).getAllByRole("listitem");

describe("the snapshot draft list", () => {
  it("is one card of rows with a small header, not a table", () => {
    render(<DraftTable jobs={[job("a", "RUNNING")]} runNotes={NOTES} />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(items()).toHaveLength(1);
    const card = screen.getByRole("list", { name: "Snapshot drafts" }).parentElement!;
    expect(card.className).toContain("rounded-xl");
    expect(card.className).toContain("bg-card");
    // The header is for the eye: every row names its own fields for a screen reader.
    expect(within(card).getByText("Name").parentElement?.getAttribute("aria-hidden")).toBe("true");
  });

  it("makes the whole row a link: the name's link is stretched over it", () => {
    render(<DraftTable jobs={[job("a", "COMPLETED")]} runNotes={NOTES} />);
    const row = items()[0];
    const link = within(row).getByRole("link", { name: "Run a" });
    expect(link.getAttribute("href")).toBe("/workspace/a");
    expect(link.className).toContain("after:absolute");
    expect(link.className).toContain("after:inset-0");
    expect(row.className).toContain("relative");
    expect(row.className).toContain("hover:bg-muted/50");
    // One link per row, and it is not the snapshot: the page says that.
    expect(within(row).getAllByRole("link")).toHaveLength(1);
  });

  it("puts the title of the snapshot under the name, in one line with the whole title on hover", () => {
    const title = "WBM v1.0.0 Global_tracking snapshot draft for 'Water balance model (WBM) v.1.0.0': [Global] [2000-2009]";
    render(<DraftTable jobs={[job("a", "COMPLETED", { dataset_title: title })]} runNotes={NOTES} />);
    const line = within(items()[0]).getByText(title);
    expect(line.getAttribute("title")).toBe(title);
    expect(line.className).toContain("truncate");
    expect(line.className).not.toContain("line-clamp");
    expect(line.parentElement?.className).toContain("text-muted-foreground");
  });

  it("makes up no name for the snapshot: nothing but its title and the run note is there", () => {
    render(<DraftTable jobs={[job("a", "COMPLETED")]} runNotes={NOTES} />);
    expect(items()[0].textContent).not.toMatch(/WBM \d|Global|Regional/);
  });

  it("adds the run period after the title only for a run shorter than the snapshot covers", () => {
    render(<DraftTable jobs={[job("a", "COMPLETED"), job("b", "FAILED")]} runNotes={NOTES} />);
    expect(within(items()[0]).queryByText(/Run 2000/)).toBeNull();
    const note = within(items()[1]).getByText(/Run 2000–2005/);
    expect(note.className).toContain("shrink-0");
  });

  it("does not print a Model Snapshot badge on every row", () => {
    render(<DraftTable jobs={[job("a", "COMPLETED"), job("b", "FAILED")]} runNotes={NOTES} />);
    expect(screen.queryByText("Model Snapshot")).toBeNull();
  });

  it("keeps the row, with the title and no run note, for a job with no note", () => {
    render(<DraftTable jobs={[job("z", "COMPLETED")]} runNotes={{}} />);
    expect(within(items()[0]).getByRole("link", { name: "Run z" })).toBeTruthy();
    expect(within(items()[0]).getByText("Dataset one")).toBeTruthy();
    expect(within(items()[0]).queryByText(/Run 2/)).toBeNull();
  });

  it("shows the status as a dot and a word in its colour, not as a bordered badge", () => {
    render(<DraftTable jobs={[job("a", "FAILED")]} runNotes={NOTES} />);
    const word = within(items()[0]).getByText("Failed");
    expect(word.className).toContain("text-status-failed");
    expect(word.className).not.toContain("border");
    expect(word.querySelector(".bg-current")).not.toBeNull();
  });

  it("prints the update time as a TimeStamp with its absolute time on hover", () => {
    render(<DraftTable jobs={[job("a", "RUNNING")]} runNotes={NOTES} />);
    const time = items()[0].querySelector("time");
    expect(time?.getAttribute("datetime")).toBe("2026-09-30T12:00:00Z");
    expect(time?.getAttribute("title")).toBeTruthy();
  });

  it("falls back to the creation time for a job that has never been updated", () => {
    render(<DraftTable jobs={[job("a", "DRAFT", { updated_at: null })]} runNotes={NOTES} />);
    expect(items()[0].querySelector("time")?.getAttribute("datetime")).toBe("2026-09-30T10:00:00Z");
  });

  it("stacks on a phone with the same markup: one list, no second copy and no table", () => {
    render(<DraftTable jobs={[job("a", "RUNNING"), job("b", "DRAFT")]} runNotes={NOTES} />);
    expect(screen.getAllByRole("list", { name: "Snapshot drafts" })).toHaveLength(1);
    // Name and meta, then status and time, with Delete beside them; from sm up they are columns.
    expect(items()[0].className).toContain("sm:grid-cols-[");
    expect(items()[0].className).toContain("grid-cols-[minmax(0,1fr)_auto]");
  });

  it("names an untitled draft 'Untitled draft', with the start of its id apart and muted", () => {
    render(
      <DraftTable
        jobs={[job("0123456789abcdef", "DRAFT", { about: null, slug: null, sim_id: "" })]}
        runNotes={NOTES}
      />
    );
    const row = items()[0];
    expect(within(row).getByRole("link", { name: "Untitled draft" })).toBeTruthy();
    const id = within(row).getByText("01234567");
    expect(id.className).toContain("font-mono");
    expect(id.className).toContain("text-muted-foreground");
    // The delete button still names the draft in full.
    expect(within(row).getByRole("button", { name: "Delete snapshot draft Untitled (01234567)" })).toBeTruthy();
  });

  it("names an untitled job by its slug, then its sim id", () => {
    render(
      <DraftTable
        jobs={[job("a", "DRAFT", { about: null, slug: "my-slug" }), job("b", "DRAFT", { about: null })]}
        runNotes={NOTES}
      />
    );
    expect(screen.getByRole("link", { name: "my-slug" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "sim-b" })).toBeTruthy();
  });

  it("offers a visible Delete on a draft and an ended job, never on an active one, and no menu", () => {
    render(
      <DraftTable
        jobs={[job("a", "RUNNING"), job("b", "DRAFT"), job("c", "FAILED"), job("d", "COMPLETING")]}
        runNotes={NOTES}
      />
    );
    expect(screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Delete snapshot draft Run b",
      "Delete snapshot draft Run c",
    ]);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("keeps Delete above the row's link, muted until hover or focus", () => {
    render(<DraftTable jobs={[job("a", "COMPLETED")]} runNotes={NOTES} />);
    const button = screen.getByRole("button", { name: "Delete snapshot draft Run a" });
    expect(button.className).toContain("z-10");
    expect(button.className).toContain("text-muted-foreground");
    expect(button.className).toContain("hover:text-destructive");
    expect(button.className).toContain("focus-visible:text-destructive");
  });

  it("opens the delete confirmation from a row's button without navigating", () => {
    render(<DraftTable jobs={[job("a", "COMPLETED")]} runNotes={NOTES} />);
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
        <DraftTable jobs={jobs} runNotes={NOTES} moreThanOnePage={moreThanOnePage} />
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
    render(<DraftTable jobs={[job("a", "COMPLETED")]} runNotes={NOTES} />);
    expect(items()).toHaveLength(1);
  });
});
