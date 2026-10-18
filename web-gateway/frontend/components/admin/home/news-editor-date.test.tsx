import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { NewsPost } from "@/lib/community/types";

const { createNews } = vi.hoisted(() => ({ createNews: vi.fn() }));
vi.mock("@/lib/community/admin-actions", () => ({
  createNews,
  updateNews: vi.fn(),
  deleteNews: vi.fn(),
  bulkContent: vi.fn(),
  bulkDeleteFiles: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/admin/home/news",
}));
vi.mock("@/components/admin/community/rich-text-editor", () => ({
  RichTextEditor: () => <div>body editor</div>,
}));

import { NewsEditor } from "@/components/admin/home/news-editor";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const stored: NewsPost = {
  id: "n9", state: "draft", slug: "python-api-v2", title: "Python API v2", tag: "announcement", summary: "",
  cover: null, date: "2026-10-10", link_label: null, link_url: null, body: null,
  created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", updated_by: "u1",
};

describe("the news editor's date", () => {
  it("is a date field, with no format to remember", () => {
    render(<NewsEditor post={stored} />);
    const date = screen.getByLabelText("Date") as HTMLInputElement;
    expect(date.type).toBe("date");
    expect(date.value).toBe("2026-10-10");
    expect(screen.queryByText(/YYYY-MM-DD/)).toBeNull();
  });

  it("is sent as YYYY-MM-DD, as before", async () => {
    createNews.mockResolvedValue({ ok: true, data: stored });
    render(<NewsEditor post={null} />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Python API v2" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-11-02" } });
    fireEvent.click(screen.getByRole("button", { name: "Create post" }));
    await waitFor(() => expect(createNews).toHaveBeenCalled());
    expect(createNews.mock.calls[0][0]).toMatchObject({ date: "2026-11-02" });
  });
});
