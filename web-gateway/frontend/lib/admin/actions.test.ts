import { beforeEach, describe, expect, it, vi } from "vitest";

const { get, backend } = vi.hoisted(() => ({ get: vi.fn(), backend: { down: false } }));
// `down` fails with a plain function: a vi.fn that throws is itself reported as a failure of the test.
vi.mock("@/lib/api-client", () => ({
  getApiClient: async () => ({
    get: (...args: unknown[]) => {
      if (backend.down) return Promise.reject(new Error("down"));
      return get(...args);
    },
  }),
}));

import { fetchAuditLog, fetchUserLabels } from "@/lib/admin/actions";

beforeEach(() => {
  get.mockReset();
  backend.down = false;
});

describe("fetchAuditLog", () => {
  it("sends only the filters that are set", async () => {
    get.mockResolvedValue({ data: { items: [] } });
    await fetchAuditLog(1);
    expect(get).toHaveBeenLastCalledWith("/api/v1/admin/audit-log", { params: { page: 1, page_size: 50 } });
    await fetchAuditLog(2, { category: "job", actor_id: "u1", date_from: "2026-10-01", date_to: "2026-10-03" }, 5);
    expect(get).toHaveBeenLastCalledWith("/api/v1/admin/audit-log", {
      params: { page: 2, page_size: 5, category: "job", actor_id: "u1", date_from: "2026-10-01", date_to: "2026-10-03" },
    });
  });
});

describe("fetchUserLabels", () => {
  it("asks once for the distinct ids and answers by id", async () => {
    get.mockResolvedValue({ data: { items: [{ id: "u1", name: "Ada", email: "ada@example.edu" }] } });
    const labels = await fetchUserLabels(["u1", "job-9", "u1", ""]);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith("/api/v1/admin/user-labels", { params: { ids: ["u1", "job-9"] } });
    expect(labels).toEqual({ u1: { id: "u1", name: "Ada", email: "ada@example.edu" } });
  });

  it("asks nothing for no ids, and answers empty when the call fails", async () => {
    expect(await fetchUserLabels([])).toEqual({});
    expect(get).not.toHaveBeenCalled();
    backend.down = true;
    expect(await fetchUserLabels(["u1"])).toEqual({});
  });
});
