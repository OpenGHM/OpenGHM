import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { DraftPager } from "@/components/workspace/draft-pager";

vi.mock("next/link", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/link")>()),
  useLinkStatus: () => ({ pending: false }),
}));

afterEach(cleanup);

const pager = (over: Partial<Parameters<typeof DraftPager>[0]> = {}) =>
  render(
    <DraftPager page={2} totalPages={7} totalCount={64} pageSize={10} status={undefined} sort="updated" {...over} />,
  );

describe("the list's pager", () => {
  it("says which rows these are and how many there are", () => {
    pager();
    expect(screen.getByText("11–20 of 64")).toBeTruthy();
    cleanup();
    pager({ page: 7, totalPages: 7, totalCount: 64 });
    expect(screen.getByText("61–64 of 64")).toBeTruthy();
  });

  it("links Previous, the page numbers and Next, keeping the filter, the size and the order", () => {
    pager({ status: "FAILED", sort: "created", pageSize: 25, totalCount: 160, totalPages: 7 });
    const pages = within(screen.getByRole("navigation", { name: "Pages" }));
    expect(pages.getByRole("link", { name: "Previous page" }).getAttribute("href")).toBe(
      "/workspace?status=FAILED&size=25&sort=created",
    );
    expect(pages.getByRole("link", { name: "Next page" }).getAttribute("href")).toBe(
      "/workspace?status=FAILED&page=3&size=25&sort=created",
    );
    expect(pages.getByRole("link", { name: "Page 7" }).getAttribute("href")).toContain("page=7");
  });

  it("marks the current page and leaves it no link", () => {
    pager();
    const current = screen.getByLabelText("Page 2 of 7");
    expect(current.getAttribute("aria-current")).toBe("page");
    expect(current.tagName).toBe("SPAN");
  });

  it("shortens a long run of pages with a gap", () => {
    pager({ page: 4, totalPages: 20, totalCount: 200 });
    const pages = screen.getByRole("navigation", { name: "Pages" });
    expect(pages.textContent).toContain("…");
    expect(within(pages).getByRole("link", { name: "Page 20" })).toBeTruthy();
    expect(within(pages).queryByRole("link", { name: "Page 12" })).toBeNull();
  });

  it("disables Previous on the first page and Next on the last: an end is a disabled button, not a gap", () => {
    pager({ page: 1 });
    expect((screen.getByRole("button", { name: "Previous page" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("link", { name: "Next page" })).toBeTruthy();
    cleanup();
    pager({ page: 7 });
    expect((screen.getByRole("button", { name: "Next page" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("offers the rows per page the backend takes, starts again from the first page, and marks the current size", () => {
    pager({ pageSize: 10, page: 3, status: "COMPLETED" });
    const sizes = within(screen.getByRole("navigation", { name: "Rows per page" }));
    expect(sizes.getAllByRole("link").map((a) => a.textContent)).toEqual(["10", "25", "50"]);
    expect(sizes.getByRole("link", { name: "25" }).getAttribute("href")).toBe("/workspace?status=COMPLETED&size=25");
    expect(sizes.getByRole("link", { name: "10" }).getAttribute("aria-current")).toBe("true");
  });

  it("has no page links when everything fits on one page, only the rows per page", () => {
    pager({ page: 1, totalPages: 1, totalCount: 12, pageSize: 25 });
    expect(screen.queryByRole("navigation", { name: "Pages" })).toBeNull();
    expect(screen.getByText("1–12 of 12")).toBeTruthy();
  });
});
