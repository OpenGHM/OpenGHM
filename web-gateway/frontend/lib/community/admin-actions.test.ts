import { beforeEach, describe, expect, it, vi } from "vitest";

const { getApiClient, revalidatePath, request, get } = vi.hoisted(() => ({
  getApiClient: vi.fn(),
  revalidatePath: vi.fn(),
  request: vi.fn(),
  get: vi.fn(),
}));
vi.mock("@/lib/api-client", () => ({ getApiClient }));
vi.mock("next/cache", () => ({ revalidatePath }));

import {
  bulkContent,
  bulkDeleteFiles,
  createTutorial,
  createWorkshop,
  deleteCommunityFile,
  deleteWorkshop,
  fetchAdminWorkshops,
  reorderTutorials,
  saveAdminSettings,
  updateWorkshop,
} from "@/lib/community/admin-actions";
import type { WorkshopInput } from "@/lib/community/types";

const input = { slug: "w", title: "W" } as WorkshopInput;
const refused = (status: number, detail: unknown) => Object.assign(new Error("x"), { response: { status, data: { detail } } });

beforeEach(() => {
  vi.clearAllMocks();
  getApiClient.mockResolvedValue({ get, request });
});

describe("reads", () => {
  it("returns the list from the admin route", async () => {
    get.mockResolvedValue({ data: [{ id: "w1" }] });
    expect(await fetchAdminWorkshops()).toEqual({ ok: true, data: [{ id: "w1" }] });
    expect(get).toHaveBeenCalledWith("/api/v1/admin/community/workshops");
  });

  it("answers session_expired when there is no session", async () => {
    getApiClient.mockRejectedValue(refused(401, "Not signed in."));
    expect(await fetchAdminWorkshops()).toEqual({ ok: false, reason: "session_expired" });
  });

  it("answers a 403 as an error with its status, for a page to tell from an outage", async () => {
    get.mockRejectedValue(refused(403, { code: "permission_required", message: "Requires permission: content:manage" }));
    expect(await fetchAdminWorkshops()).toMatchObject({ ok: false, reason: "error", status: 403 });
  });
});

describe("writes", () => {
  it("posts a new workshop and refreshes the public pages", async () => {
    request.mockResolvedValue({ data: { id: "w1" } });
    expect(await createWorkshop(input)).toEqual({ ok: true, data: { id: "w1" } });
    expect(request).toHaveBeenCalledWith({ method: "post", url: "/api/v1/admin/community/workshops", data: input });
    expect(revalidatePath).toHaveBeenCalledWith("/community", "layout");
  });

  it("puts to the item's own address, with the id encoded", async () => {
    request.mockResolvedValue({ data: { id: "a/b" } });
    await updateWorkshop("a/b", input);
    expect(request).toHaveBeenCalledWith({ method: "put", url: "/api/v1/admin/community/workshops/a%2Fb", data: input });
  });

  it("answers a delete's empty body as null", async () => {
    request.mockResolvedValue({ data: "", status: 204 });
    expect(await deleteWorkshop("w1")).toEqual({ ok: true, data: null });
    expect(await deleteCommunityFile("f1")).toEqual({ ok: true, data: null });
    expect(request).toHaveBeenLastCalledWith({ method: "delete", url: "/api/v1/admin/community/files/f1", data: undefined });
  });

  it("sends the new order of the tutorials", async () => {
    request.mockResolvedValue({ data: "" });
    await reorderTutorials(["b", "a"]);
    expect(request).toHaveBeenCalledWith({
      method: "post",
      url: "/api/v1/admin/community/tutorials/reorder",
      data: { ids: ["b", "a"] },
    });
  });

  it("posts a bulk action to the kind's bulk route and refreshes the public pages", async () => {
    request.mockResolvedValue({ data: { done: ["a", "b"], missing: ["c"] } });
    expect(await bulkContent("tutorials", "publish", ["a", "b", "c"])).toEqual({
      ok: true,
      data: { done: ["a", "b"], missing: ["c"] },
    });
    expect(request).toHaveBeenCalledWith({
      method: "post",
      url: "/api/v1/admin/community/tutorials/bulk",
      data: { action: "publish", ids: ["a", "b", "c"] },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/community", "layout");
    await bulkContent("publications", "delete", ["p"]);
    expect(request).toHaveBeenLastCalledWith({
      method: "post",
      url: "/api/v1/admin/community/publications/bulk",
      data: { action: "delete", ids: ["p"] },
    });
  });

  it("posts the files to delete to bulk-delete", async () => {
    request.mockResolvedValue({ data: { done: ["f1"], missing: [] } });
    expect(await bulkDeleteFiles(["f1"])).toEqual({ ok: true, data: { done: ["f1"], missing: [] } });
    expect(request).toHaveBeenCalledWith({
      method: "post",
      url: "/api/v1/admin/community/files/bulk-delete",
      data: { ids: ["f1"] },
    });
  });

  it("maps a refused bulk request like any other write", async () => {
    request.mockRejectedValue(refused(401, "Not signed in."));
    expect(await bulkContent("workshops", "delete", ["w"])).toEqual({ ok: false, reason: "session_expired" });
    request.mockRejectedValue(refused(422, [{ loc: ["body", "ids"], msg: "List should have at least 1 item", type: "x" }]));
    expect(await bulkDeleteFiles([])).toMatchObject({
      ok: false,
      reason: "error",
      errors: [{ path: "ids", message: "List should have at least 1 item" }],
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("saves the settings with PUT", async () => {
    request.mockResolvedValue({ data: { hero_title: "Learn" } });
    await saveAdminSettings({ hero_title: "Learn", hero_intro: "", show_groups: true, groups_title: "G", groups_intro: "" });
    expect(request.mock.calls[0][0]).toMatchObject({ method: "put", url: "/api/v1/admin/community/settings" });
  });

  it("does not refresh the public pages when the write failed", async () => {
    request.mockRejectedValue(refused(409, { code: "slug_taken", message: "That slug is already used." }));
    const result = await createTutorial({ slug: "t" } as never);
    expect(result).toMatchObject({ ok: false, reason: "error", status: 409, errors: [{ path: "slug" }] });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("maps a 422 to a message per field", async () => {
    request.mockRejectedValue(refused(422, [{ loc: ["body", "date"], msg: "Input should be a valid date", type: "x" }]));
    expect(await createWorkshop(input)).toMatchObject({
      ok: false,
      errors: [{ path: "date", message: "Input should be a valid date" }],
    });
  });

  it("still succeeds when revalidating throws outside a request", async () => {
    revalidatePath.mockImplementation(() => {
      throw new Error("static generation store missing");
    });
    request.mockResolvedValue({ data: { id: "w1" } });
    expect(await createWorkshop(input)).toMatchObject({ ok: true });
  });

  it("answers an ended session when a write has no session", async () => {
    getApiClient.mockRejectedValue(refused(401, "Not signed in."));
    expect(await deleteWorkshop("w1")).toEqual({ ok: false, reason: "session_expired" });
  });
});
