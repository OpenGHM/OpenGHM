import { describe, expect, it } from "vitest";
import {
  emptyPublicationForm,
  emptyTutorialForm,
  emptyWorkshopForm,
  fingerprint,
  newRowKey,
  publicationToInput,
  sentPathToFormPath,
  settingsToInput,
  tutorialToInput,
  validatePublication,
  validateSettings,
  validateTutorial,
  validateWorkshop,
  workshopToForm,
  workshopToInput,
  type WorkshopForm,
} from "@/lib/community/admin-forms";
import type { Workshop } from "@/lib/community/types";

function validWorkshop(): WorkshopForm {
  return { ...emptyWorkshopForm(), title: "First workshop", slug: "first-workshop", date: "2027-02-15" };
}

describe("workshop form", () => {
  it("is fit to send with a title, a slug and a date", () => {
    expect(validateWorkshop(validWorkshop())).toEqual({});
  });

  it("asks for what is missing", () => {
    const errors = validateWorkshop(emptyWorkshopForm());
    expect(Object.keys(errors).sort()).toEqual(["date", "slug", "title"]);
  });

  it("checks the dates", () => {
    expect(validateWorkshop({ ...validWorkshop(), date: "2027-02-30" }).date).toBeTruthy();
    expect(validateWorkshop({ ...validWorkshop(), endDate: "2027-02-01" }).end_date).toMatch(/before/);
    expect(validateWorkshop({ ...validWorkshop(), endDate: "2027-02-15" })).toEqual({});
    expect(validateWorkshop({ ...validWorkshop(), endDate: "soon" }).end_date).toBeTruthy();
  });

  it("wants alt text with a cover, and a cover with its alt text", () => {
    const f = validWorkshop();
    expect(validateWorkshop({ ...f, cover: { url: "https://a.org/p.png", alt: "", caption: "" } })["cover.alt"]).toBeTruthy();
    expect(validateWorkshop({ ...f, cover: { url: "", alt: "A hall", caption: "" } })["cover.url"]).toBeTruthy();
    expect(validateWorkshop({ ...f, cover: { url: "http://a.org/p.png", alt: "A", caption: "" } })["cover.url"]).toBeTruthy();
  });

  it("wants both halves of a sign-up link, a detail row and a material, by row", () => {
    const f: WorkshopForm = {
      ...validWorkshop(),
      signup: { label: "Sign up", url: "" },
      details: [
        { key: "a", label: "", value: "" },
        { key: "b", label: "Computing", value: "" },
      ],
      materials: [{ key: "c", name: "Slides", url: "" }, { key: "d", name: "", url: "", note: "" }].map((m) => ({ note: "", ...m })),
    };
    const errors = validateWorkshop(f);
    expect(errors["signup.url"]).toBeTruthy();
    expect(errors["details.0.label"]).toBeUndefined();
    expect(errors["details.1.value"]).toBeTruthy();
    expect(errors["materials.0.url"]).toBeTruthy();
    expect(errors["materials.1.name"]).toBeUndefined();
  });

  it("refuses a material link that is not https or a path", () => {
    const f: WorkshopForm = {
      ...validWorkshop(),
      materials: [{ key: "a", name: "Slides", url: "javascript:alert(1)", note: "" }],
    };
    expect(validateWorkshop(f)["materials.0.url"]).toBeTruthy();
  });

  it("holds each text to the length the backend stores", () => {
    const f = validWorkshop();
    expect(validateWorkshop({ ...f, whenLabel: "x".repeat(101) }).when_label).toMatch(/100/);
    expect(validateWorkshop({ ...f, format: "x".repeat(61) }).format).toMatch(/60/);
    expect(validateWorkshop({ ...f, details: [{ key: "a", label: "x".repeat(81), value: "v" }] })["details.0.label"]).toMatch(/80/);
    expect(validateWorkshop({ ...f, materials: [{ key: "a", name: "n", url: "/x", note: "x".repeat(301) }] })["materials.0.note"]).toMatch(/300/);
  });

  it("limits the lists", () => {
    const rows = Array.from({ length: 21 }, (_, i) => ({ key: `k${i}`, label: "a", value: "b" }));
    expect(validateWorkshop({ ...validWorkshop(), details: rows }).details).toMatch(/20/);
  });

  it("turns blank optional text into null and drops blank rows", () => {
    const input = workshopToInput({
      ...validWorkshop(),
      summary: "  A summary  ",
      endDate: " ",
      format: "Online",
      details: [
        { key: "a", label: "", value: "" },
        { key: "b", label: " Computing ", value: " Anvil " },
      ],
      materials: [{ key: "m", name: "Slides", url: "/api/community/files/0123456789abcdef01234567", note: "PDF · 1 MB" }],
    });
    expect(input).toMatchObject({
      state: "draft",
      slug: "first-workshop",
      summary: "A summary",
      end_date: null,
      when_label: null,
      format: "Online",
      location: null,
      cover: null,
      signup: null,
      details: [{ label: "Computing", value: "Anvil" }],
      materials: [{ name: "Slides", url: "/api/community/files/0123456789abcdef01234567", note: "PDF · 1 MB" }],
      body: null,
    });
  });

  it("round-trips a stored workshop, and an untouched form sends what was stored", () => {
    const stored: Workshop = {
      id: "w1",
      state: "published",
      status: "upcoming",
      created_at: "2026-10-01T00:00:00Z",
      updated_at: "2026-10-02T00:00:00Z",
      updated_by: "u1",
      slug: "first",
      title: "First",
      summary: "S",
      date: "2027-02-15",
      end_date: "2027-03-31",
      when_label: "February–March 2027",
      format: "Online",
      location: null,
      cover: { url: "https://a.org/p.png", alt: "A", caption: null },
      signup: { label: "Sign up", url: "https://a.org/s" },
      details: [{ label: "Computing", value: "Anvil" }],
      materials: [{ name: "Slides", url: "https://a.org/s.pdf", note: null }],
      body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }] },
    };
    const input = workshopToInput(workshopToForm(stored));
    const { id, status, created_at, updated_at, updated_by, ...sent } = stored;
    void [id, status, created_at, updated_at, updated_by];
    expect(input).toEqual(sent);
    expect(fingerprint(input)).toBe(fingerprint(workshopToInput(workshopToForm(stored))));
  });

  it("gives each row a new key", () => {
    expect(newRowKey()).not.toBe(newRowKey());
  });

  it("maps a refused row's index, counted among the rows that were sent, back to the form's row", () => {
    const f = {
      details: [
        { key: "a", label: "", value: "" },
        { key: "b", label: "Computing", value: "" },
      ],
      materials: [],
    };
    expect(sentPathToFormPath("details.0.value", f)).toBe("details.1.value");
    expect(sentPathToFormPath("title", f)).toBe("title");
    expect(sentPathToFormPath("details.5.label", f)).toBe("details.5.label");
  });
});

describe("tutorial form", () => {
  it("needs a title and a slug", () => {
    expect(Object.keys(validateTutorial(emptyTutorialForm())).sort()).toEqual(["slug", "title"]);
  });

  it("checks minutes, the snippet and the address", () => {
    const f = { ...emptyTutorialForm(), title: "T", slug: "t" };
    expect(validateTutorial({ ...f, minutes: "20" })).toEqual({});
    expect(validateTutorial({ ...f, minutes: "0" }).minutes).toBeTruthy();
    expect(validateTutorial({ ...f, minutes: "601" }).minutes).toBeTruthy();
    expect(validateTutorial({ ...f, minutes: "1.5" }).minutes).toBeTruthy();
    expect(validateTutorial({ ...f, snippet: "x".repeat(601) }).snippet).toBeTruthy();
    expect(validateTutorial({ ...f, url: "ftp://a.org" }).url).toBeTruthy();
    expect(validateTutorial({ ...f, url: "/workspace" })).toEqual({});
  });

  it("sends minutes as a number and a blank button text as null", () => {
    const input = tutorialToInput({ ...emptyTutorialForm(), title: " T ", slug: "t", minutes: "15", snippet: "$ openghm" });
    expect(input).toMatchObject({ title: "T", minutes: 15, action_label: null, url: null, snippet: "$ openghm", body: null });
    expect(tutorialToInput({ ...emptyTutorialForm(), minutes: "" }).minutes).toBeNull();
  });
});

describe("publication form", () => {
  const f = { ...emptyPublicationForm(2026), title: "A paper" };

  it("needs a title and a year in range", () => {
    expect(validatePublication(f)).toEqual({});
    expect(validatePublication({ ...f, title: "" }).title).toBeTruthy();
    expect(validatePublication({ ...f, year: "1899" }).year).toBeTruthy();
    expect(validatePublication({ ...f, year: "20x6" }).year).toBeTruthy();
  });

  it("wants an address with a link label, and a valid address", () => {
    expect(validatePublication({ ...f, linkLabel: "DOI" }).link_url).toBeTruthy();
    expect(validatePublication({ ...f, linkUrl: "doi.org/x" }).link_url).toBeTruthy();
    expect(validatePublication({ ...f, linkLabel: "DOI", linkUrl: "https://doi.org/x" })).toEqual({});
  });

  it("sends the year as a number and a blank citation as null", () => {
    expect(publicationToInput({ ...f, year: " 2025 " })).toMatchObject({ year: 2025, citation: null, link_label: null, link_url: null });
  });
});

describe("settings form", () => {
  const f = { hero_title: "Learn", hero_intro: "", show_groups: true, groups_title: "Groups", groups_intro: "" };

  it("needs a page title, and a section title while the section shows", () => {
    expect(validateSettings(f)).toEqual({});
    expect(validateSettings({ ...f, hero_title: " " }).hero_title).toBeTruthy();
    expect(validateSettings({ ...f, groups_title: "" }).groups_title).toBeTruthy();
    expect(validateSettings({ ...f, groups_title: "", show_groups: false })).toEqual({});
  });

  it("trims what it sends", () => {
    expect(settingsToInput({ ...f, hero_title: "  Learn  " }).hero_title).toBe("Learn");
  });
});
