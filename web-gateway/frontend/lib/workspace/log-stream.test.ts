import { describe, expect, it } from "vitest";
import type { JobLogChunk } from "@/lib/jobs/types";
import { INITIAL_STREAM, applyChunk, hasMore, previewStreamState } from "@/lib/workspace/log-stream";
import { displayLines } from "@/lib/workspace/log-lines";

const chunk = (over: Partial<JobLogChunk>): JobLogChunk => ({
  job_id: "j",
  stream: "wbm",
  exists: true,
  data: "",
  offset: 0,
  next_offset: 0,
  size: 0,
  eof: true,
  ...over,
});

describe("applyChunk", () => {
  it("starts a tail from byte 0 as the whole file", () => {
    const s = applyChunk(INITIAL_STREAM, chunk({ data: "a\nb\n", next_offset: 4, size: 4 }));
    expect(s.exists).toBe(true);
    expect(s.startedMidway).toBe(false);
    expect(s.nextOffset).toBe(4);
    expect(displayLines(s.text)).toEqual(["a", "b"]);
  });

  it("marks a tail that began after byte 0 as the end of a longer log", () => {
    const s = applyChunk(INITIAL_STREAM, chunk({ data: "x\n", offset: 900, next_offset: 902, size: 902 }));
    expect(s.startedMidway).toBe(true);
    expect(s.size).toBe(902);
  });

  it("appends the next chunk and finishes a split line", () => {
    let s = applyChunk(INITIAL_STREAM, chunk({ data: "one\ntw", next_offset: 6, size: 10, eof: false }));
    s = applyChunk(s, chunk({ data: "o\nthree\n", offset: 6, next_offset: 14, size: 14 }));
    expect(displayLines(s.text)).toEqual(["one", "two", "three"]);
    expect(s.nextOffset).toBe(14);
    expect(s.startedMidway).toBe(false);
  });

  it("keeps startedMidway once set", () => {
    let s = applyChunk(INITIAL_STREAM, chunk({ data: "x\n", offset: 100, next_offset: 102, size: 102 }));
    s = applyChunk(s, chunk({ data: "y\n", offset: 102, next_offset: 104, size: 104 }));
    expect(s.startedMidway).toBe(true);
  });

  it("is loaded but empty when the file is not there, and tails again when it appears", () => {
    let s = applyChunk(INITIAL_STREAM, chunk({ exists: false }));
    expect(s.loaded).toBe(true);
    expect(s.exists).toBe(false);
    expect(s.nextOffset).toBeNull();
    s = applyChunk(s, chunk({ data: "hello\n", next_offset: 6, size: 6 }));
    expect(displayLines(s.text)).toEqual(["hello"]);
  });

  it("forgets the text when the file disappears (a purge)", () => {
    let s = applyChunk(INITIAL_STREAM, chunk({ data: "a\n", next_offset: 2, size: 2 }));
    s = applyChunk(s, chunk({ exists: false, offset: 2 }));
    expect(s.exists).toBe(false);
    expect(s.text.lines).toEqual([]);
  });
});

describe("hasMore", () => {
  it("reads again at once only when it is not at the end and it moved on", () => {
    expect(hasMore(chunk({ eof: false, offset: 0, next_offset: 100 }), 0)).toBe(true);
    expect(hasMore(chunk({ eof: false, offset: 0, next_offset: 100 }), null)).toBe(true);
    expect(hasMore(chunk({ eof: true, next_offset: 100 }), 0)).toBe(false);
    expect(hasMore(chunk({ eof: false, next_offset: 100 }), 100)).toBe(false);
    expect(hasMore(chunk({ exists: false, eof: false, next_offset: 100 }), 0)).toBe(false);
  });
});

describe("previewStreamState", () => {
  it("shows fixed text, or a log never written", () => {
    expect(previewStreamState("a\nb").exists).toBe(true);
    const none = previewStreamState(undefined);
    expect(none.exists).toBe(false);
    expect(none.loaded).toBe(true);
  });
});
