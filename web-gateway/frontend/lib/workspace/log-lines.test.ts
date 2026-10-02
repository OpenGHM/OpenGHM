import { describe, expect, it } from "vitest";
import {
  EMPTY_LOG_TEXT,
  MAX_LOG_LINES,
  appendText,
  collapseCr,
  displayLines,
  SHORT_EXCERPT_CHARS,
  SHORT_EXCERPT_LINES,
  isEmptyText,
  isShortExcerpt,
} from "@/lib/workspace/log-lines";

describe("collapseCr", () => {
  it("keeps only what follows the last carriage return", () => {
    expect(collapseCr("10%\r50%\r100%")).toBe("100%");
    expect(collapseCr("plain")).toBe("plain");
  });
  it("does not treat a CRLF ending as an overwrite", () => {
    expect(collapseCr("done\r")).toBe("done");
    expect(collapseCr("a\rb\r")).toBe("b");
  });
});

describe("appendText", () => {
  it("splits complete lines and keeps the unfinished one apart", () => {
    const t = appendText(EMPTY_LOG_TEXT, "one\ntwo\nthr");
    expect(t.lines).toEqual(["one", "two"]);
    expect(t.partial).toBe("thr");
    expect(displayLines(t)).toEqual(["one", "two", "thr"]);
  });

  it("completes a line split across chunks instead of showing it in two", () => {
    let t = appendText(EMPTY_LOG_TEXT, "File wbm_2001.nc (2001-0");
    expect(displayLines(t)).toEqual(["File wbm_2001.nc (2001-0"]);
    t = appendText(t, "3-04) Balance\nnext");
    expect(t.lines).toEqual(["File wbm_2001.nc (2001-03-04) Balance"]);
    expect(displayLines(t)).toEqual(["File wbm_2001.nc (2001-03-04) Balance", "next"]);
  });

  it("has no unfinished line after a chunk that ends in a newline", () => {
    const t = appendText(EMPTY_LOG_TEXT, "a\nb\n");
    expect(t.partial).toBe("");
    expect(displayLines(t)).toEqual(["a", "b"]);
  });

  it("keeps empty lines", () => {
    expect(appendText(EMPTY_LOG_TEXT, "a\n\nb\n").lines).toEqual(["a", "", "b"]);
  });

  it("collapses carriage-return progress, also across a chunk boundary", () => {
    let t = appendText(EMPTY_LOG_TEXT, "copy 10%\rcopy 50%");
    expect(displayLines(t)).toEqual(["copy 50%"]);
    t = appendText(t, "\rcopy 100%\nnext\n");
    expect(t.lines).toEqual(["copy 100%", "next"]);
  });

  it("does not change the text it was given", () => {
    const before = appendText(EMPTY_LOG_TEXT, "a\nb");
    appendText(before, "c\nd\n");
    expect(before.lines).toEqual(["a"]);
    expect(before.partial).toBe("b");
  });

  it("ignores an empty chunk", () => {
    const t = appendText(EMPTY_LOG_TEXT, "a\n");
    expect(appendText(t, "")).toBe(t);
  });

  it("drops the oldest lines past the cap and counts them", () => {
    const data = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
    const t = appendText(EMPTY_LOG_TEXT, data, 10);
    expect(t.lines).toHaveLength(10);
    expect(t.lines[0]).toBe("line 3");
    expect(t.dropped).toBe(2);
    const more = appendText(t, "line 13\n", 10);
    expect(more.lines[0]).toBe("line 4");
    expect(more.dropped).toBe(3);
  });

  it("caps at 10,000 lines by default", () => {
    expect(MAX_LOG_LINES).toBe(10_000);
    const data = Array.from({ length: MAX_LOG_LINES + 5 }, (_, i) => String(i)).join("\n") + "\n";
    const t = appendText(EMPTY_LOG_TEXT, data);
    expect(t.lines).toHaveLength(MAX_LOG_LINES);
    expect(t.dropped).toBe(5);
  });
});

describe("isEmptyText", () => {
  it("is empty only with no lines and no partial", () => {
    expect(isEmptyText(EMPTY_LOG_TEXT)).toBe(true);
    expect(isEmptyText(appendText(EMPTY_LOG_TEXT, "x"))).toBe(false);
  });
});

describe("isShortExcerpt", () => {
  const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n");

  it("is short up to the line limit, and not past it", () => {
    expect(isShortExcerpt(lines(1))).toBe(true);
    expect(isShortExcerpt(lines(SHORT_EXCERPT_LINES))).toBe(true);
    expect(isShortExcerpt(lines(SHORT_EXCERPT_LINES + 1))).toBe(false);
  });

  it("is short up to the character limit, and not past it", () => {
    expect(isShortExcerpt("x".repeat(SHORT_EXCERPT_CHARS))).toBe(true);
    expect(isShortExcerpt("x".repeat(SHORT_EXCERPT_CHARS + 1))).toBe(false);
  });

  it("does not count trailing newlines as lines or characters", () => {
    expect(isShortExcerpt(lines(SHORT_EXCERPT_LINES) + "\n\n")).toBe(true);
    expect(isShortExcerpt("x".repeat(SHORT_EXCERPT_CHARS) + "\n")).toBe(true);
  });
});
