import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { feedItem } from "@/components/landing/home-feed.fixtures";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ getApiClient: vi.fn(async () => ({ get })) }));

import { fetchAllUpdates, fetchHomeUpdates } from "@/lib/home/data";

const items = [
  feedItem({ id: "n", kind: "news" }),
  feedItem({ id: "d", kind: "dataset" }),
  feedItem({ id: "w", kind: "workshop" }),
];

beforeEach(() => get.mockResolvedValue({ data: { settings: {}, items } }));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("the feed with the Data Repository on or off", () => {
  it("keeps the datasets while it is on", async () => {
    expect((await fetchHomeUpdates()).items.map((i) => i.id)).toEqual(["n", "d", "w"]);
    expect((await fetchAllUpdates()).items.map((i) => i.id)).toEqual(["n", "d", "w"]);
  });

  it("leaves the datasets out of both feeds while it is off", async () => {
    vi.stubEnv("REPOSITORY_ENABLED", "false");
    expect((await fetchHomeUpdates()).items.map((i) => i.id)).toEqual(["n", "w"]);
    expect((await fetchAllUpdates()).items.map((i) => i.id)).toEqual(["n", "w"]);
  });
});
