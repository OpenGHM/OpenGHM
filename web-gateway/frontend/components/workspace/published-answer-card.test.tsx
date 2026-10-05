import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import { PublishedAnswerCard } from "@/components/workspace/published-answer-card";
import type { PublishedAnswer, PublishedFile } from "@/lib/jobs/types";

afterEach(cleanup);

const BASE = "https://s3.example.org/openghm/snapshots/s1/wbm_output/WBM_test";
const file = (group: PublishedFile["group"], year: number, variable: string | null, size: number): PublishedFile => ({
  group,
  variable,
  year,
  size,
  key: `snapshots/s1/wbm_output/WBM_test/${group}/${variable ? `${variable}/` : ""}wbm_${year}.nc`,
  url: `${BASE}/${group}/${variable ? `${variable}/` : ""}wbm_${year}.nc`,
});

const ANSWER: PublishedAnswer = {
  answered: true,
  reasons: [],
  period: { start: "2000-01-01", end: "2001-12-31" },
  run_id: "WBM_test",
  // Deliberately out of order: the card groups and sorts them.
  files: [
    file("yearly", 2001, "runoff", 2_500_000),
    file("daily", 2001, null, 696_923_827),
    file("monthly", 2000, "discharge", 1_572_864),
    file("daily", 2000, null, 700_000_000),
    file("monthly", 2001, "discharge", 1_048_576),
    file("monthly", 2000, "runoff", 2048),
    file("yearly", 2000, "runoff", 512),
  ],
};

const section = (name: string) => screen.getByRole("region", { name });

describe("PublishedAnswerCard", () => {
  it("names the published period and the run it comes from", () => {
    render(<PublishedAnswerCard answer={ANSWER} draftStart="2000-01-01" />);
    expect(screen.getByRole("heading", { name: "Results already published" })).toBeTruthy();
    expect(screen.getByText("Published period").nextElementSibling?.textContent).toBe("2000-01-01 → 2001-12-31");
    expect(screen.getByText("Run").nextElementSibling?.textContent).toBe("WBM_test");
  });

  it("groups the files as Daily, Monthly and Yearly, in that order, each with its count", () => {
    render(<PublishedAnswerCard answer={ANSWER} draftStart="2000-01-01" />);
    const titles = screen.getAllByRole("heading", { level: 4 }).map((h) => h.firstElementChild?.textContent);
    expect(titles).toEqual(["Daily", "Monthly", "Yearly"]);
    expect(within(section("Daily files")).getByText(/2 files/)).toBeTruthy();
    expect(within(section("Monthly files")).getByText(/3 files/)).toBeTruthy();
    expect(within(section("Yearly files")).getByText(/2 files/)).toBeTruthy();
  });

  it("lists the daily files by year, with no variable heading, sorted", () => {
    render(<PublishedAnswerCard answer={ANSWER} draftStart="2000-01-01" />);
    const daily = section("Daily files");
    const links = within(daily).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("aria-label"))).toEqual(["Download daily 2000", "Download daily 2001"]);
    expect(daily.textContent).not.toMatch(/discharge|runoff/);
  });

  it("groups monthly and yearly files by variable, years ascending", () => {
    render(<PublishedAnswerCard answer={ANSWER} draftStart="2000-01-01" />);
    const monthly = section("Monthly files");
    expect(within(monthly).getAllByRole("link").map((a) => a.getAttribute("aria-label"))).toEqual([
      "Download monthly discharge 2000",
      "Download monthly discharge 2001",
      "Download monthly runoff 2000",
    ]);
    expect(within(monthly).getByText("discharge")).toBeTruthy();
    expect(within(monthly).getByText("runoff")).toBeTruthy();
    expect(within(section("Yearly files")).getAllByRole("link").map((a) => a.getAttribute("aria-label"))).toEqual([
      "Download yearly runoff 2000",
      "Download yearly runoff 2001",
    ]);
  });

  it("links each file to its public URL with a plain anchor", () => {
    render(<PublishedAnswerCard answer={ANSWER} draftStart="2000-01-01" />);
    const link = screen.getByRole("link", { name: "Download monthly runoff 2000" });
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe(`${BASE}/monthly/runoff/wbm_2000.nc`);
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("writes sizes for people: bytes, KB, MB", () => {
    render(<PublishedAnswerCard answer={ANSWER} draftStart="2000-01-01" />);
    const monthly = section("Monthly files");
    expect(within(monthly).getByText("1.5 MB")).toBeTruthy();
    expect(within(monthly).getByText("1.0 MB")).toBeTruthy();
    expect(within(monthly).getByText("2.0 KB")).toBeTruthy();
    expect(within(section("Yearly files")).getByText("512 B")).toBeTruthy();
    expect(within(section("Daily files")).getByText("664.6 MB")).toBeTruthy();
  });

  it("says that files are per year and a daily file holds every published variable", () => {
    render(<PublishedAnswerCard answer={ANSWER} draftStart="2000-01-01" />);
    expect(screen.getByText(/Files are per year, and a daily file holds every published variable/)).toBeTruthy();
  });

  it("does not say the years come from an earlier run when the draft starts with the published run", () => {
    render(<PublishedAnswerCard answer={ANSWER} draftStart="2000-01-01" />);
    expect(screen.queryByText(/spinup began earlier/)).toBeNull();
  });

  it("says the years come from the published run when the draft starts later", () => {
    render(<PublishedAnswerCard answer={ANSWER} draftStart="2001-03-01" />);
    expect(screen.getByText(/These years come from the published run, whose spinup began earlier/)).toBeTruthy();
  });

  it("leaves a group out when it has no files", () => {
    render(
      <PublishedAnswerCard
        answer={{ ...ANSWER, files: ANSWER.files.filter((f) => f.group === "daily") }}
        draftStart="2000-01-01"
      />
    );
    expect(screen.queryByRole("region", { name: "Monthly files" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Yearly files" })).toBeNull();
  });
});
