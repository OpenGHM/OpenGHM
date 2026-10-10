import { describe, expect, it } from "vitest";
import {
  isAllowedImageSrc,
  isAllowedLinkHref,
  isEmptyDoc,
  isRichTextTooLarge,
  normalizeDoc,
  normalizeLinkInput,
} from "@/lib/community/admin-richtext";
import type { RichTextDoc } from "@/lib/community/types";

const p = (text: string, marks?: { type: string; attrs?: Record<string, unknown> }[]) => ({
  type: "paragraph",
  content: [{ type: "text", text, ...(marks ? { marks } : {}) }],
});

describe("link and image addresses", () => {
  it("accepts http(s), mailto and a single-slash path for links", () => {
    for (const href of ["https://a.org/x", "http://a.org", "mailto:a@b.org", "/community/workshops", "/"]) {
      expect(isAllowedLinkHref(href), href).toBe(true);
    }
  });

  it("refuses script, protocol-relative, relative and spaced links", () => {
    for (const href of ["javascript:alert(1)", "//evil.org", "/\\evil.org", "data:text/html,x", "example.org", "https://a b", "", "ftp://x.org"]) {
      expect(isAllowedLinkHref(href), href).toBe(false);
    }
  });

  it("accepts an image from https or the upload route only", () => {
    expect(isAllowedImageSrc("https://a.org/p.png")).toBe(true);
    expect(isAllowedImageSrc("/api/community/files/0123456789abcdef01234567")).toBe(true);
    expect(isAllowedImageSrc("http://a.org/p.png")).toBe(false);
    expect(isAllowedImageSrc("/api/community/files/nothex")).toBe(false);
    expect(isAllowedImageSrc("/other/p.png")).toBe(false);
    expect(isAllowedImageSrc("data:image/png;base64,AAAA")).toBe(false);
  });

  it("turns what a person typed into an address", () => {
    expect(normalizeLinkInput("https://a.org")).toBe("https://a.org");
    expect(normalizeLinkInput("  a@b.org ")).toBe("mailto:a@b.org");
    expect(normalizeLinkInput("example.org/path")).toBe("https://example.org/path");
    expect(normalizeLinkInput("/community")).toBe("/community");
    expect(normalizeLinkInput("javascript:alert(1)")).toBeNull();
    expect(normalizeLinkInput("//evil.org")).toBeNull();
    expect(normalizeLinkInput("not a link")).toBeNull();
    expect(normalizeLinkInput("")).toBeNull();
  });
});

describe("an empty document", () => {
  it("is null, an empty doc, or only empty paragraphs", () => {
    expect(isEmptyDoc(null)).toBe(true);
    expect(isEmptyDoc({ type: "doc" })).toBe(true);
    expect(isEmptyDoc({ type: "doc", content: [{ type: "paragraph" }] })).toBe(true);
    expect(isEmptyDoc({ type: "doc", content: [p("   ")] })).toBe(true);
    expect(isEmptyDoc({ type: "doc", content: [{ type: "paragraph", content: [{ type: "hardBreak" }] }] })).toBe(true);
  });

  it("is not empty with text, a rule, an image or text inside a list", () => {
    expect(isEmptyDoc({ type: "doc", content: [p("Hi")] })).toBe(false);
    expect(isEmptyDoc({ type: "doc", content: [{ type: "horizontalRule" }] })).toBe(false);
    expect(isEmptyDoc({ type: "doc", content: [{ type: "image", attrs: { src: "https://a.org/p.png" } }] })).toBe(false);
    expect(
      isEmptyDoc({
        type: "doc",
        content: [{ type: "bulletList", content: [{ type: "listItem", content: [p("one")] }] }],
      })
    ).toBe(false);
  });
});

describe("normalizeDoc", () => {
  it("is null for an empty document", () => {
    expect(normalizeDoc({ type: "doc", content: [{ type: "paragraph" }] })).toBeNull();
    expect(normalizeDoc(null)).toBeNull();
  });

  it("keeps what the schema allows and cuts attributes to the ones it names", () => {
    const doc: RichTextDoc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 3, id: "x" }, content: [{ type: "text", text: "Title" }] },
        p("Read", [
          { type: "bold" },
          { type: "link", attrs: { href: "https://a.org", target: "_blank", rel: "noopener", class: null } },
        ]),
        { type: "orderedList", attrs: { start: 4, type: null }, content: [{ type: "listItem", content: [p("a")] }] },
        { type: "codeBlock", attrs: { language: "py" }, content: [{ type: "text", text: "x = 1" }] },
        { type: "image", attrs: { src: "https://a.org/p.png", alt: "A", title: "Caption", width: 10, height: 10 } },
      ],
    };
    expect(normalizeDoc(doc)).toEqual({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Title" }] },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Read",
              marks: [{ type: "bold" }, { type: "link", attrs: { href: "https://a.org" } }],
            },
          ],
        },
        { type: "orderedList", content: [{ type: "listItem", content: [p("a")] }] },
        { type: "codeBlock", content: [{ type: "text", text: "x = 1" }] },
        { type: "image", attrs: { src: "https://a.org/p.png", alt: "A", title: "Caption" } },
      ],
    });
  });

  it("puts a heading outside level 2 and 3 back to 2, and drops unknown nodes and marks", () => {
    const doc: RichTextDoc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Big" }] },
        { type: "table", content: [] },
        p("x", [{ type: "textStyle", attrs: { color: "red" } }, { type: "italic" }]),
      ],
    };
    expect(normalizeDoc(doc)?.content).toEqual([
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Big" }] },
      { type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "italic" }] }] },
    ]);
  });

  it("drops a link the backend would refuse but keeps its text, and an image with a refused address", () => {
    const doc: RichTextDoc = {
      type: "doc",
      content: [
        p("click", [{ type: "link", attrs: { href: "javascript:alert(1)" } }]),
        { type: "image", attrs: { src: "http://insecure.org/p.png", alt: "x" } },
      ],
    };
    expect(normalizeDoc(doc)).toEqual({ type: "doc", content: [p("click")] });
  });

  it("omits an empty alt or caption", () => {
    const doc: RichTextDoc = {
      type: "doc",
      content: [{ type: "image", attrs: { src: "https://a.org/p.png", alt: "", title: "  " } }],
    };
    expect(normalizeDoc(doc)?.content?.[0]).toEqual({ type: "image", attrs: { src: "https://a.org/p.png" } });
  });
});

describe("the size limit", () => {
  it("is 512 KiB of serialized document", () => {
    const small: RichTextDoc = { type: "doc", content: [p("hi")] };
    const big: RichTextDoc = { type: "doc", content: [p("x".repeat(600 * 1024))] };
    expect(isRichTextTooLarge(small)).toBe(false);
    expect(isRichTextTooLarge(big)).toBe(true);
    expect(isRichTextTooLarge(null)).toBe(false);
  });
});
