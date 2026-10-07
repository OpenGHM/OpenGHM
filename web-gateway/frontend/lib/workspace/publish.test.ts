import { describe, expect, it } from "vitest";
import type { PartialAbout, PublishRecord } from "@/lib/jobs/types";
import { fakePublish } from "@/lib/workspace/fixtures";
import {
  aboutFromForm,
  aboutFromRecord,
  canPublish,
  fieldOfPath,
  firstInvalid,
  formFromAbout,
  isValid,
  parseKeywords,
  publishPhase,
  splitServerErrors,
  validatePublishForm,
  type PublishFormValues,
} from "@/lib/workspace/publish";

const GOOD_ABOUT: PartialAbout = {
  name: "A run",
  description: "What it holds.",
  tags: ["tutorial"],
  creator: [{ name: "Ada", email: "ada@example.test" }],
  license: "CC-BY-4.0",
  keywords: ["wbm", "discharge"],
};

const completed = { status: "COMPLETED" as const, failure: null, files: "present" as const };

describe("canPublish", () => {
  it("offers a completed draft with no publish, or a failed one", () => {
    expect(canPublish({ ...completed, publish: null })).toBe(true);
    expect(canPublish({ ...completed, publish: undefined })).toBe(true);
    expect(canPublish({ ...completed, publish: fakePublish("publish_job_failed") })).toBe(true);
  });

  it("does not offer one that is publishing or published", () => {
    expect(canPublish({ ...completed, publish: fakePublish("publishing") })).toBe(false);
    expect(canPublish({ ...completed, publish: fakePublish("published") })).toBe(false);
  });

  it("does not offer a draft whose simulation did not complete, carries a failure, or lost its files", () => {
    for (const status of ["DRAFT", "PENDING", "SUBMITTED", "RUNNING", "COMPLETING", "FAILED", "CANCELLED"] as const) {
      expect(canPublish({ ...completed, status, publish: null })).toBe(false);
    }
    const failure = { cause: "wbm_error" as const, phase: null, message: "m", excerpt: null };
    expect(canPublish({ ...completed, failure, publish: null })).toBe(false);
    expect(canPublish({ ...completed, files: "purged", publish: null })).toBe(false);
    expect(canPublish({ ...completed, files: null, publish: null })).toBe(true);
  });
});

describe("publishPhase", () => {
  it("is none without a record, else the record's state", () => {
    expect(publishPhase(null)).toBe("none");
    expect(publishPhase(fakePublish("publishing"))).toBe("publishing");
    expect(publishPhase(fakePublish("published"))).toBe("published");
    expect(publishPhase(fakePublish("publish_setup"))).toBe("failed");
  });
});

describe("the form", () => {
  it("starts from the stored about, and from nothing at all", () => {
    expect(formFromAbout(GOOD_ABOUT)).toEqual({
      name: "A run",
      description: "What it holds.",
      creators: [{ name: "Ada", email: "ada@example.test", orcid: "" }],
      license: "CC-BY-4.0",
      keywords: "wbm, discharge",
      tags: ["tutorial"],
    });
    const empty = formFromAbout(null);
    expect(empty.creators).toEqual([{ name: "", email: "", orcid: "" }]);
    expect(empty.tags).toEqual([]);
  });

  it("drops a tag that is not on the spec's closed list", () => {
    const about = { ...GOOD_ABOUT, tags: ["tutorial", "not-a-tag"] } as unknown as PartialAbout;
    expect(formFromAbout(about).tags).toEqual(["tutorial"]);
  });

  it("splits keywords on commas, trimmed, without blanks or repeats", () => {
    expect(parseKeywords(" a, b ,,a,  c ")).toEqual(["a", "b", "c"]);
    expect(parseKeywords("  ")).toEqual([]);
  });

  it("passes a complete about", () => {
    expect(isValid(validatePublishForm(formFromAbout(GOOD_ABOUT)))).toBe(true);
  });

  it("asks for each thing the spec requires", () => {
    const errors = validatePublishForm(formFromAbout(null));
    expect(Object.keys(errors.fields).sort()).toEqual(["creator", "description", "keywords", "license", "name", "tags"]);
    expect(firstInvalid(errors)).toBe("name");
  });

  it("checks a creator row's email and ORCID, and a license that is a URL", () => {
    const values: PublishFormValues = {
      ...formFromAbout(GOOD_ABOUT),
      creators: [{ name: "Ada", email: "not-an-email", orcid: "123" }, { name: "", email: "b@example.test", orcid: "" }],
      license: "https://spdx.org/licenses/MIT.html",
    };
    const errors = validatePublishForm(values);
    expect(errors.creators[0]).toEqual({ email: "Not an email address.", orcid: "Use the form 0000-0002-1825-0097." });
    expect(errors.creators[1]).toEqual({ name: "A creator needs a name." });
    expect(errors.fields.license).toMatch(/SPDX identifier/);
    expect(firstInvalid(errors)).toBe("creator");
    // An ORCID may end in X.
    expect(validatePublishForm({ ...values, creators: [{ name: "Ada", email: "", orcid: "0000-0002-1825-009X" }], license: "MIT" }).creators).toEqual({});
  });

  it("ignores a creator row nobody filled, as long as one is", () => {
    const values: PublishFormValues = {
      ...formFromAbout(GOOD_ABOUT),
      creators: [{ name: "Ada", email: "", orcid: "" }, { name: "", email: "", orcid: "" }],
    };
    expect(isValid(validatePublishForm(values))).toBe(true);
    expect(aboutFromForm(values, null).creator).toEqual([{ name: "Ada" }]);
  });

  it("builds the request's about: trimmed, only what a person writes, and the stored related links as they are", () => {
    const related = [{ relation: "cites", url: "https://example.test/paper" }];
    const body = aboutFromForm(
      { ...formFromAbout(GOOD_ABOUT), name: "  A run ", keywords: "a, b" },
      { ...GOOD_ABOUT, relatedLink: related }
    );
    expect(body).toEqual({
      name: "A run",
      description: "What it holds.",
      creator: [{ name: "Ada", email: "ada@example.test" }],
      license: "CC-BY-4.0",
      keywords: ["a", "b"],
      tags: ["tutorial"],
      relatedLink: related,
    });
    expect(Object.keys(body)).not.toContain("datePublished");
    expect(Object.keys(body)).not.toContain("url");
    expect(Object.keys(body)).not.toContain("isBasedOn");
    expect(Object.keys(aboutFromForm(formFromAbout(GOOD_ABOUT), GOOD_ABOUT))).not.toContain("relatedLink");
  });
});

describe("aboutFromRecord", () => {
  it("reads back what a publish was composed from, without what the gateway set", () => {
    const about = aboutFromRecord(fakePublish("publish_bad_input"));
    expect(about?.name).toBe("WBM v2 tutorial, 2001, rerun");
    expect(about).not.toHaveProperty("datePublished");
    expect(about).not.toHaveProperty("url");
    expect(about).not.toHaveProperty("isBasedOn");
  });

  it("is null when there is no record, or it holds no about", () => {
    expect(aboutFromRecord(null)).toBeNull();
    expect(aboutFromRecord({ ...fakePublish("publishing"), metadata: {} } as PublishRecord)).toBeNull();
  });
});

describe("what the backend refused", () => {
  it("maps a path to the field it names", () => {
    expect(fieldOfPath("about.tags.0")).toBe("tags");
    expect(fieldOfPath("about.creator.1.email")).toBe("creator");
    expect(fieldOfPath("body.about.license")).toBe("license");
    expect(fieldOfPath("about.keywords[2]")).toBe("keywords");
    expect(fieldOfPath("about.slug")).toBeNull();
    expect(fieldOfPath(null)).toBeNull();
  });

  it("puts a message beside its field, and keeps the ones that name none apart", () => {
    const split = splitServerErrors([
      { path: "about.name", message: "Too short." },
      { path: "about.name", message: "Has no letters." },
      { path: "about.tags.0", message: "Not a known tag." },
      { path: null, message: "The document is not valid." },
    ]);
    expect(split.fields).toEqual({ name: "Too short. Has no letters.", tags: "Not a known tag." });
    expect(split.general).toEqual(["The document is not valid."]);
    expect(splitServerErrors(undefined)).toEqual({ fields: {}, general: [] });
  });
});
