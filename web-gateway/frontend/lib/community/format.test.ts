import { describe, expect, it } from "vitest";
import {
  citationText,
  countLabel,
  dateBadge,
  defaultActionLabel,
  formatDateRange,
  formatLongDate,
  levelBars,
  materialKind,
  minutesLabel,
  parseTab,
  splitWorkshops,
  tabHref,
  tutorialActionLabel,
  tutorialLink,
  whenLabel,
  workshopHints,
} from "./format";

describe("dates", () => {
  it("splits a date into the badge's month, day and year", () => {
    expect(dateBadge("2024-12-10")).toEqual({ month: "DEC", day: "10", year: "2024" });
    expect(dateBadge("2027-02-03")).toEqual({ month: "FEB", day: "3", year: "2027" });
  });

  it("leaves the badge blank for something that is not a date", () => {
    expect(dateBadge("soon")).toEqual({ month: "", day: "", year: "" });
    expect(dateBadge("2024-13-01")).toEqual({ month: "", day: "", year: "" });
  });

  it("writes a day in words, the same in every time zone", () => {
    expect(formatLongDate("2024-12-10")).toBe("December 10, 2024");
    expect(formatLongDate("2027-01-01")).toBe("January 1, 2027");
    expect(formatLongDate("nope")).toBe("nope");
  });

  it("writes a run of days as short as it can be", () => {
    expect(formatDateRange("2027-03-03", null)).toBe("March 3, 2027");
    expect(formatDateRange("2027-03-03", "2027-03-03")).toBe("March 3, 2027");
    expect(formatDateRange("2027-03-03", "2027-03-05")).toBe("March 3–5, 2027");
    expect(formatDateRange("2027-02-28", "2027-03-02")).toBe("February 28 – March 2, 2027");
    expect(formatDateRange("2026-12-30", "2027-01-02")).toBe("December 30, 2026 – January 2, 2027");
  });
});

describe("whenLabel", () => {
  it("prefers the admin's own wording", () => {
    expect(whenLabel({ when_label: "February–March 2027", date: "2027-02-01", end_date: null })).toBe(
      "February–March 2027"
    );
  });

  it("falls back to the formatted date when the label is null or blank", () => {
    expect(whenLabel({ when_label: null, date: "2024-12-10", end_date: null })).toBe("December 10, 2024");
    expect(whenLabel({ when_label: "  ", date: "2024-12-10", end_date: "2024-12-11" })).toBe("December 10–11, 2024");
  });
});

describe("splitWorkshops", () => {
  const w = (title: string, date: string, status: "upcoming" | "past", end_date: string | null = null) => ({
    title,
    date,
    end_date,
    status,
  });

  it("puts the soonest upcoming workshop first and the latest past one first", () => {
    const { upcoming, past } = splitWorkshops([
      w("late", "2027-05-01", "upcoming"),
      w("old", "2023-01-01", "past"),
      w("soon", "2027-02-01", "upcoming"),
      w("recent", "2024-12-10", "past"),
    ]);
    expect(upcoming.map((x) => x.title)).toEqual(["soon", "late"]);
    expect(past.map((x) => x.title)).toEqual(["recent", "old"]);
  });

  it("sorts a past workshop by the day it ended", () => {
    const { past } = splitWorkshops([
      w("a", "2024-01-01", "past", "2024-06-01"),
      w("b", "2024-03-01", "past", "2024-03-02"),
    ]);
    expect(past.map((x) => x.title)).toEqual(["a", "b"]);
  });

  it("does not change the list it was given", () => {
    const list = [w("b", "2027-02-01", "upcoming"), w("a", "2027-01-01", "upcoming")];
    splitWorkshops(list);
    expect(list.map((x) => x.title)).toEqual(["b", "a"]);
  });
});

describe("workshopHints and countLabel", () => {
  it("names what a workshop has from its counts", () => {
    expect(workshopHints({ photo_count: 3, material_count: 2 })).toEqual(["Photos", "Materials"]);
    expect(workshopHints({ photo_count: 0, material_count: 2 })).toEqual(["Materials"]);
    expect(workshopHints({ photo_count: 3, material_count: 0 })).toEqual(["Photos"]);
    expect(workshopHints({ photo_count: 0, material_count: 0 })).toEqual([]);
  });

  it("counts in the singular and the plural", () => {
    expect(countLabel(1, "photo")).toBe("1 photo");
    expect(countLabel(12, "photo")).toBe("12 photos");
    expect(countLabel(0, "file")).toBe("0 files");
  });
});

describe("tutorials", () => {
  it("fills the level glyph by level", () => {
    expect(levelBars("beginner")).toBe(1);
    expect(levelBars("intermediate")).toBe(2);
    expect(levelBars("advanced")).toBe(3);
  });

  it("labels the length, or says nothing", () => {
    expect(minutesLabel(20)).toBe("20 min");
    expect(minutesLabel(null)).toBeNull();
    expect(minutesLabel(0)).toBeNull();
  });

  it("names a tutorial's action by its kind unless the admin wrote one", () => {
    expect(defaultActionLabel("gateway")).toBe("Start tutorial");
    expect(defaultActionLabel("guide")).toBe("Start tutorial");
    expect(defaultActionLabel("notebook")).toBe("Open notebook");
    expect(defaultActionLabel("video")).toBe("Watch video");
    expect(tutorialActionLabel({ kind: "notebook", action_label: null })).toBe("Open notebook");
    expect(tutorialActionLabel({ kind: "notebook", action_label: "  " })).toBe("Open notebook");
    expect(tutorialActionLabel({ kind: "notebook", action_label: "Run it in Colab" })).toBe("Run it in Colab");
  });

  describe("tutorialLink", () => {
    it("goes to the tutorial's own page when it has a body, even with a url", () => {
      expect(tutorialLink({ slug: "first", has_body: true, url: "https://example.org" })).toEqual({
        href: "/community/tutorials/first",
        external: false,
      });
    });

    it("else to its url, outside the site when that is http(s)", () => {
      expect(tutorialLink({ slug: "a", has_body: false, url: "https://example.org/nb" })).toEqual({
        href: "https://example.org/nb",
        external: true,
      });
      expect(tutorialLink({ slug: "a", has_body: false, url: "/workspace/new" })).toEqual({
        href: "/workspace/new",
        external: false,
      });
    });

    it("else nowhere, and never to an unsafe address", () => {
      expect(tutorialLink({ slug: "a", has_body: false, url: null })).toBeNull();
      expect(tutorialLink({ slug: "a", has_body: false, url: "" })).toBeNull();
      expect(tutorialLink({ slug: "a", has_body: false, url: "javascript:alert(1)" })).toBeNull();
    });
  });
});

describe("citationText", () => {
  const p = { authors: "Grogan, D. S.", year: 2022, title: "WBM v1.0.0", venue: "GMD, 15" };

  it("uses the admin's citation", () => {
    expect(citationText({ ...p, citation: "Grogan et al. 2022, GMD." })).toBe("Grogan et al. 2022, GMD.");
  });

  it("builds one from the parts when there is none", () => {
    expect(citationText({ ...p, citation: null })).toBe("Grogan, D. S. (2022). WBM v1.0.0. GMD, 15.");
    expect(citationText({ ...p, citation: "   " })).toBe("Grogan, D. S. (2022). WBM v1.0.0. GMD, 15.");
  });
});

describe("materialKind", () => {
  it.each([
    ["https://example.org/slides.pdf", "PDF", true],
    ["https://example.org/slides.PDF?download=1", "PDF", true],
    ["https://example.org/deck.pptx", "PPT", true],
    ["https://example.org/deck.key", "PPT", true],
    ["https://example.org/notes.docx", "DOC", true],
    ["https://example.org/table.xlsx", "XLS", true],
    ["https://example.org/data.csv", "XLS", true],
    ["https://example.org/all.zip", "ZIP", true],
    ["https://example.org/all.tar", "ZIP", true],
    ["https://example.org/nb.ipynb", "IPYNB", true],
    ["https://example.org/talk.mp4", "VIDEO", true],
    ["https://example.org/pic.png#x", "IMG", true],
    ["https://example.org/pic.webp", "IMG", true],
    ["https://example.org/recording", "LINK", false],
    ["https://example.org/page.html", "LINK", false],
    ["https://youtu.be/abc", "LINK", false],
    ["/workspace", "LINK", false],
  ])("reads %s as %s (download: %s)", (url, tag, download) => {
    expect(materialKind({ name: "x", url, note: null })).toEqual({ tag, download });
  });

  it("reads an uploaded file from its name, and always offers it as a download", () => {
    const url = "/api/community/files/65f1a2b3c4d5e6f708192a3b";
    expect(materialKind({ name: "Slides.pdf", url, note: null })).toEqual({ tag: "PDF", download: true });
    expect(materialKind({ name: "Notebook.IPYNB", url, note: null })).toEqual({ tag: "IPYNB", download: true });
    expect(materialKind({ name: "Handout", url, note: null })).toEqual({ tag: "LINK", download: true });
  });

  it("falls back to the type word of the note the CMS writes on upload", () => {
    const url = "/api/community/files/65f1a2b3c4d5e6f708192a3b";
    expect(materialKind({ name: "Workshop slides", url, note: "PDF · 6.1 MB" })).toEqual({ tag: "PDF", download: true });
    expect(materialKind({ name: "Deck", url, note: "PPTX · 2 MB" })).toEqual({ tag: "PPT", download: true });
    expect(materialKind({ name: "Deck.zip", url, note: "PDF · 2 MB" })).toEqual({ tag: "ZIP", download: true });
    // Only an upload reads its note: a link's note is free text.
    expect(materialKind({ name: "Recording", url: "https://youtu.be/abc", note: "MP4" })).toEqual({ tag: "LINK", download: false });
  });
});

describe("tabs", () => {
  it("reads ?tab=", () => {
    expect(parseTab("workshops", true)).toBe("workshops");
    expect(parseTab("tutorials", false)).toBe("tutorials");
    expect(parseTab("publications", true)).toBe("publications");
    expect(parseTab(["tutorials", "groups"], true)).toBe("tutorials");
  });

  it("falls back to All for anything else", () => {
    expect(parseTab(undefined, true)).toBe("all");
    expect(parseTab("nonsense", true)).toBe("all");
    expect(parseTab("pubs", true)).toBe("all");
    expect(parseTab("", true)).toBe("all");
  });

  it("has no Groups tab when the groups band is off", () => {
    expect(parseTab("groups", true)).toBe("groups");
    expect(parseTab("groups", false)).toBe("all");
  });

  it("writes a tab's address, All being the bare page", () => {
    expect(tabHref("all")).toBe("/community");
    expect(tabHref("workshops")).toBe("/community?tab=workshops");
  });
});
