import { beforeEach, describe, expect, it, vi } from "vitest";

const { getApiClient, get } = vi.hoisted(() => ({ getApiClient: vi.fn(), get: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ getApiClient }));

import { DEFAULT_COMMUNITY_SETTINGS } from "./settings";
import {
  fetchCommunityPage,
  fetchTutorial,
  fetchWorkshop,
  withDefaults,
} from "./data";

beforeEach(() => {
  get.mockReset();
  getApiClient.mockReset();
  getApiClient.mockResolvedValue({ get });
});

describe("withDefaults", () => {
  it("uses the design's words when the backend sends no settings", () => {
    const page = withDefaults(null);
    expect(page.settings).toEqual(DEFAULT_COMMUNITY_SETTINGS);
    expect(page.settings.hero_title).toBe("Learn, publish and work together");
    expect(page.settings.show_groups).toBe(true);
    expect(page.workshops).toEqual([]);
    expect(page.tutorials).toEqual([]);
    expect(page.publications).toEqual([]);
    expect(page.group_interest).toBe(false);
  });

  it("keeps an admin's words, including turning groups off and clearing the intro", () => {
    const page = withDefaults({
      settings: {
        hero_title: "Our community",
        hero_intro: "",
        show_groups: false,
        groups_title: "",
        groups_intro: "Soon.",
        updated_at: "2026-10-01T00:00:00Z",
        updated_by: "u1",
      },
      group_interest: true,
    });
    expect(page.settings.hero_title).toBe("Our community");
    expect(page.settings.hero_intro).toBe("");
    expect(page.settings.show_groups).toBe(false);
    expect(page.settings.groups_title).toBe("Discussion groups");
    expect(page.settings.groups_intro).toBe("Soon.");
    expect(page.group_interest).toBe(true);
  });
});

describe("fetchCommunityPage", () => {
  it("reads /community anonymously", async () => {
    get.mockResolvedValue({ data: { settings: DEFAULT_COMMUNITY_SETTINGS, workshops: [], tutorials: [], publications: [], group_interest: true } });
    const page = await fetchCommunityPage();
    expect(getApiClient).toHaveBeenCalledWith({ allowAnonymous: true });
    expect(get).toHaveBeenCalledWith("/api/v1/community");
    expect(page.group_interest).toBe(true);
  });

  it("lets a backend failure through, for the page to show its error box", async () => {
    get.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(fetchCommunityPage()).rejects.toThrow("ECONNREFUSED");
  });
});

describe.each([
  ["fetchWorkshop", fetchWorkshop, "workshops"],
  ["fetchTutorial", fetchTutorial, "tutorials"],
] as const)("%s", (_name, fetcher, segment) => {
  it("reads the item by its slug", async () => {
    get.mockResolvedValue({ data: { slug: "first-one" } });
    await expect(fetcher("first-one")).resolves.toEqual({ slug: "first-one" });
    expect(get).toHaveBeenCalledWith(`/api/v1/community/${segment}/first-one`);
  });

  it("answers null on a 404", async () => {
    get.mockRejectedValue({ response: { status: 404 } });
    await expect(fetcher("gone")).resolves.toBeNull();
  });

  it("does not ask the backend about something that cannot be a slug", async () => {
    await expect(fetcher("../../admin")).resolves.toBeNull();
    await expect(fetcher("Has Spaces")).resolves.toBeNull();
    expect(get).not.toHaveBeenCalled();
  });

  it("throws on any other failure", async () => {
    get.mockRejectedValue({ response: { status: 500 } });
    await expect(fetcher("first-one")).rejects.toBeTruthy();
  });
});
