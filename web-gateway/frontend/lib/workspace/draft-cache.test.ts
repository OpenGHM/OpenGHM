import { beforeEach, describe, expect, it } from "vitest";
import { fakeSimulation } from "@/lib/workspace/fixtures";
import {
  clearDraftCache,
  newerJob,
  readDraftCache,
  writeDraftCache,
} from "@/lib/workspace/draft-cache";

const at = (iso: string | null, id = "job-1") =>
  fakeSimulation("DRAFT", { id, updated_at: iso, slug: iso });

const OLD = "2026-10-01T10:00:00.000Z";
const MID = "2026-10-01T10:00:05.000Z";
const NEW = "2026-10-01T10:00:09.000Z";

beforeEach(() => clearDraftCache());

describe("writeDraftCache / readDraftCache", () => {
  it("holds nothing for a draft it has not seen", () => {
    expect(readDraftCache("job-1")).toBeUndefined();
  });

  it("keeps the newest copy, whatever order the writes come in", () => {
    writeDraftCache(at(MID));
    writeDraftCache(at(OLD));
    expect(readDraftCache("job-1")?.updated_at).toBe(MID);
    writeDraftCache(at(NEW));
    expect(readDraftCache("job-1")?.updated_at).toBe(NEW);
  });

  it("replaces a copy with one of the same time, the later write being the later answer", () => {
    writeDraftCache(fakeSimulation("DRAFT", { id: "job-1", updated_at: MID, slug: "first" }));
    writeDraftCache(fakeSimulation("DRAFT", { id: "job-1", updated_at: MID, slug: "second" }));
    expect(readDraftCache("job-1")?.slug).toBe("second");
  });

  it("treats a missing timestamp as older than any", () => {
    writeDraftCache(at(null));
    writeDraftCache(at(OLD));
    expect(readDraftCache("job-1")?.updated_at).toBe(OLD);
    writeDraftCache(at(null));
    expect(readDraftCache("job-1")?.updated_at).toBe(OLD);
  });

  it("keeps drafts apart", () => {
    writeDraftCache(at(OLD, "job-1"));
    writeDraftCache(at(NEW, "job-2"));
    expect(readDraftCache("job-1")?.updated_at).toBe(OLD);
    expect(readDraftCache("job-2")?.updated_at).toBe(NEW);
  });

  it("forgets one draft or all", () => {
    writeDraftCache(at(OLD, "job-1"));
    writeDraftCache(at(OLD, "job-2"));
    clearDraftCache("job-1");
    expect(readDraftCache("job-1")).toBeUndefined();
    expect(readDraftCache("job-2")).toBeDefined();
    clearDraftCache();
    expect(readDraftCache("job-2")).toBeUndefined();
  });
});

describe("newerJob", () => {
  it("is the server's job when nothing is cached", () => {
    const server = at(MID);
    expect(newerJob(server)).toBe(server);
  });

  it("is the cached job when it was saved after the server's page was rendered", () => {
    const cached = at(NEW);
    writeDraftCache(cached);
    expect(newerJob(at(MID))).toBe(cached);
  });

  it("is the server's job when it is newer, or the same age", () => {
    writeDraftCache(at(MID));
    const newer = at(NEW);
    expect(newerJob(newer)).toBe(newer);
    const same = at(MID);
    expect(newerJob(same)).toBe(same);
  });

  it("does not remember the server's job by itself", () => {
    newerJob(at(NEW));
    expect(readDraftCache("job-1")).toBeUndefined();
  });
});
