import { describe, expect, it } from "vitest";
import {
  acceptFor,
  checkUpload,
  citationPreview,
  defaultActionLabel,
  fileExtension,
  formatFileSize,
  isImageType,
  isValidImageUrl,
  isValidLinkUrl,
  isValidSlug,
  MAX_UPLOAD_BYTES,
  moveItem,
  slugify,
  uploadNote,
} from "@/lib/community/admin-format";

describe("slugify", () => {
  it("makes a slug of lower-case words and single hyphens", () => {
    expect(slugify("First OpenGHM Workshop Announcement!")).toBe("first-openghm-workshop-announcement");
    expect(slugify("  AGU 2024 — Workshop  ")).toBe("agu-2024-workshop");
  });

  it("drops accents", () => {
    expect(slugify("Café São Paulo")).toBe("cafe-sao-paulo");
  });

  it("is empty for a title with nothing to keep and never ends in a hyphen when cut", () => {
    expect(slugify("한글")).toBe("");
    const long = slugify(`${"a".repeat(79)} bbb`);
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith("-")).toBe(false);
  });

  it("always gives a valid slug or an empty one", () => {
    for (const title of ["Hello, World", "x--y", "A_B C", "2027 Q1"]) {
      const slug = slugify(title);
      expect(slug === "" || isValidSlug(slug), title).toBe(true);
    }
  });
});

describe("isValidSlug", () => {
  it("follows the backend's pattern and length", () => {
    expect(isValidSlug("agu-2024")).toBe(true);
    for (const bad of ["", "-a", "a-", "a--b", "A", "a b", "a".repeat(81)]) expect(isValidSlug(bad), bad).toBe(false);
  });
});

describe("file sizes and notes", () => {
  it("writes sizes the way people do", () => {
    expect(formatFileSize(812)).toBe("812 B");
    expect(formatFileSize(340 * 1024)).toBe("340 KB");
    expect(formatFileSize(6.1 * 1024 * 1024)).toBe("6.1 MB");
    expect(formatFileSize(25 * 1024 * 1024)).toBe("25 MB");
    expect(formatFileSize(3 * 1024 ** 3)).toBe("3 GB");
  });

  it("makes the note of an upload as the template writes it", () => {
    expect(uploadNote("slides.PDF", 6.1 * 1024 * 1024)).toBe("PDF · 6.1 MB");
    expect(uploadNote("README", 100)).toBe("100 B");
  });

  it("reads an extension", () => {
    expect(fileExtension("a.tar.gz")).toBe("gz");
    expect(fileExtension("Photo.JPG")).toBe("jpg");
    expect(fileExtension(".env")).toBe("");
    expect(fileExtension("noext")).toBe("");
    expect(fileExtension("trailing.")).toBe("");
  });
});

describe("checkUpload", () => {
  it("accepts an allowed image and file", () => {
    expect(checkUpload({ name: "a.png", size: 10 }, "image")).toBeNull();
    expect(checkUpload({ name: "deck.pptx", size: 10 }, "file")).toBeNull();
    // A file slot takes images too.
    expect(checkUpload({ name: "a.webp", size: 10 }, "file")).toBeNull();
  });

  it("refuses a document where an image is needed, SVG anywhere, and unknown types", () => {
    expect(checkUpload({ name: "a.pdf", size: 10 }, "image")).toMatch(/not an image/);
    expect(checkUpload({ name: "a.svg", size: 10 }, "image")).toMatch(/not an image/);
    expect(checkUpload({ name: "a.svg", size: 10 }, "file")).toMatch(/can't be uploaded/);
    expect(checkUpload({ name: "a.exe", size: 10 }, "file")).toMatch(/\.exe/);
    expect(checkUpload({ name: "noext", size: 10 }, "file")).toMatch(/can't be uploaded/);
  });

  it("refuses an empty file and one over 25 MiB, naming both sizes", () => {
    expect(checkUpload({ name: "a.png", size: 0 }, "image")).toBe("That file is empty.");
    const over = checkUpload({ name: "a.mp4", size: MAX_UPLOAD_BYTES + 1 }, "file");
    expect(over).toMatch(/25 MB/);
    expect(checkUpload({ name: "a.mp4", size: MAX_UPLOAD_BYTES }, "file")).toBeNull();
  });

  it("lists the allowed extensions for a file input", () => {
    expect(acceptFor("image")).toBe(".jpg,.jpeg,.png,.webp,.gif");
    expect(acceptFor("file")).toContain(".pdf");
    expect(acceptFor("file")).toContain(".png");
    expect(acceptFor("file")).not.toContain("svg");
  });
});

describe("images and addresses", () => {
  it("tells an image from another file by content type", () => {
    expect(isImageType("image/png")).toBe(true);
    expect(isImageType("application/pdf")).toBe(false);
  });

  it("accepts https and paths, refuses the rest", () => {
    expect(isValidLinkUrl("https://a.org")).toBe(true);
    expect(isValidLinkUrl("http://a.org")).toBe(true);
    expect(isValidLinkUrl("/workspace")).toBe(true);
    expect(isValidLinkUrl("mailto:a@b.org")).toBe(true);
    expect(isValidLinkUrl("https://")).toBe(false);
    expect(isValidLinkUrl("/\\evil.org")).toBe(false);
    expect(isValidLinkUrl("https://a.org/a b")).toBe(false);
    expect(isValidLinkUrl("//a.org")).toBe(false);
    expect(isValidLinkUrl("javascript:alert(1)")).toBe(false);
    expect(isValidLinkUrl("a.org")).toBe(false);
    expect(isValidImageUrl("http://a.org/p.png")).toBe(false);
    expect(isValidImageUrl("https://a.org/p.png")).toBe(true);
    expect(isValidImageUrl("/api/community/files/0123456789abcdef01234567")).toBe(true);
    // The backend takes an image from https or an upload only, not any path.
    expect(isValidImageUrl("/images/p.png")).toBe(false);
  });
});

describe("citationPreview", () => {
  const base = { authors: "Kim, I.", year: 2026, title: "A paper.", venue: "Nature" };

  it("builds the generated citation", () => {
    expect(citationPreview(base)).toBe("Kim, I. (2026). A paper. Nature.");
  });

  it("uses a written citation as it is", () => {
    expect(citationPreview({ ...base, citation: "  Kim 2026, Nature.  " })).toBe("Kim 2026, Nature.");
  });

  it("holds each missing part's place", () => {
    expect(citationPreview({ authors: "", year: "", title: "", venue: "", citation: null })).toBe(
      "Authors (Year). Title. Venue."
    );
  });
});

describe("small helpers", () => {
  it("gives each kind of tutorial its default button text", () => {
    expect(defaultActionLabel("gateway")).toBe("Start tutorial");
    expect(defaultActionLabel("guide")).toBe("Start tutorial");
    expect(defaultActionLabel("notebook")).toBe("Open notebook");
    expect(defaultActionLabel("video")).toBe("Watch video");
  });

  it("moves an item without changing the list it was given", () => {
    const list = ["a", "b", "c"];
    expect(moveItem(list, 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(list, 2, 1)).toEqual(["a", "c", "b"]);
    expect(moveItem(list, 1, 5)).toEqual(["a", "b", "c"]);
    expect(moveItem(list, -1, 0)).toEqual(["a", "b", "c"]);
    expect(list).toEqual(["a", "b", "c"]);
  });
});
