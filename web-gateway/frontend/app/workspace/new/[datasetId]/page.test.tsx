import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const { workspaceSession, previewDraft, fetchDatasetById, fetchMe } = vi.hoisted(() => ({
  workspaceSession: vi.fn(),
  previewDraft: vi.fn(),
  fetchDatasetById: vi.fn(),
  fetchMe: vi.fn(),
}));
vi.mock("@/lib/auth-guard", () => ({ workspaceSession }));
vi.mock("@/lib/jobs/actions", () => ({ previewDraft }));
vi.mock("@/lib/repository/actions", () => ({ fetchDatasetById }));
vi.mock("@/lib/account/actions", () => ({ fetchMe }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/components/landing/header", () => ({ Header: () => <header /> }));
vi.mock("@/components/landing/footer", () => ({ Footer: () => <footer /> }));
vi.mock("@/components/workspace/draft-wizard", () => ({ DraftWizard: () => <div data-testid="wizard" /> }));

import NewDraftFromSnapshotPage from "./page";

const MESSAGE =
  "This snapshot runs WBM code 22.1.1, which is legacy: snapshots on it keep working, but no new snapshot draft starts from them, so a new snapshot draft cannot start from it. Start from a snapshot on current code (23.9.0).";

const open = (id = "snap-1") =>
  NewDraftFromSnapshotPage({ params: Promise.resolve({ datasetId: id }), searchParams: Promise.resolve({}) });

beforeEach(() => {
  workspaceSession.mockResolvedValue({ session: {} });
  fetchMe.mockResolvedValue(null);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("opening /workspace/new/<snapshot id>", () => {
  it("shows the backend's sentence and the way back to the snapshot choice when its WBM code is not current, not a blank wizard", async () => {
    previewDraft.mockResolvedValue({ ok: false, reason: "error", status: 422, code: "wbm_code_not_current", message: MESSAGE });
    render(await open());
    expect(screen.getByRole("alert").textContent).toBe(MESSAGE);
    expect(screen.getByRole("link", { name: "Choose another model snapshot" }).getAttribute("href")).toBe("/workspace/new");
    expect(screen.queryByTestId("wizard")).toBeNull();
    expect(fetchDatasetById).not.toHaveBeenCalled();
  });

  it("still throws for a failure it has no page for, so the route's error boundary shows it", async () => {
    previewDraft.mockResolvedValue({ ok: false, reason: "error", status: 500, code: "server_error", message: "boom" });
    await expect(open()).rejects.toThrow("boom");
  });
});
