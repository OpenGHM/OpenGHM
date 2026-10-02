import { beforeEach, describe, expect, it, vi } from "vitest";

const { get, getApiClient } = vi.hoisted(() => {
  const get = vi.fn();
  return { get, getApiClient: vi.fn(async () => ({ get })) };
});
vi.mock("@/lib/api-client", () => ({ getApiClient }));

import { fetchMine } from "./actions";

beforeEach(() => {
  get.mockReset();
  getApiClient.mockClear();
});

describe("fetchMine", () => {
  it("asks for the caller's own published items, with the session's client, and returns the body", async () => {
    const body = { items: [{ id: "snap-1", kind: "snapshot" }] };
    get.mockResolvedValue({ data: body });

    await expect(fetchMine()).resolves.toBe(body);

    expect(getApiClient).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith("/api/v1/repository/mine");
  });

  it("lets a failure through, a 401 included, for the page to decide on", async () => {
    const unauthorized = { response: { status: 401 } };
    get.mockRejectedValue(unauthorized);

    await expect(fetchMine()).rejects.toBe(unauthorized);
  });
});
