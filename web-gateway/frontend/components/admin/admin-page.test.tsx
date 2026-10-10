import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/admin" }));

import { AdminPage } from "@/components/admin/admin-page";
import { LoadingPage } from "@/components/admin/admin-skeletons";

afterEach(cleanup);

describe("AdminPage", () => {
  it("renders the title as the h1, the description and the content", () => {
    render(
      <AdminPage title="Users" description="User directory.">
        <p>Body</p>
      </AdminPage>
    );
    expect(screen.getByRole("heading", { level: 1, name: "Users" })).toBeTruthy();
    expect(screen.getByText("User directory.")).toBeTruthy();
    expect(screen.getByText("Body")).toBeTruthy();
  });

  it("renders the actions beside the title", () => {
    render(
      <AdminPage title="Workshops" actions={<button type="button">New workshop</button>}>
        <p>Body</p>
      </AdminPage>
    );
    // In the header, with the title, not down in the content.
    const header = screen.getByRole("heading", { level: 1 }).closest("header");
    expect(within(header as HTMLElement).getByRole("button", { name: "New workshop" })).toBeTruthy();
  });

  it("renders a breadcrumb whose last item is the current page and not a link", () => {
    render(
      <AdminPage
        title="Ada"
        breadcrumb={[{ label: "Admin", href: "/admin" }, { label: "Users", href: "/admin/users" }, { label: "Ada" }]}
      >
        <p>Body</p>
      </AdminPage>
    );
    const trail = within(screen.getByRole("navigation", { name: "Breadcrumb" }));
    expect(trail.getByRole("link", { name: "Users" }).getAttribute("href")).toBe("/admin/users");
    expect(trail.queryByRole("link", { name: "Ada" })).toBeNull();
    expect(trail.getByText("Ada").getAttribute("aria-current")).toBe("page");
  });

  it("has no breadcrumb or actions region unless asked", () => {
    render(
      <AdminPage title="Jobs">
        <p>Body</p>
      </AdminPage>
    );
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).toBeNull();
  });
});

describe("LoadingPage", () => {
  it("is one announced status that waits before it shows, and has no heading of its own", () => {
    render(
      <LoadingPage>
        <div>rows</div>
      </LoadingPage>
    );
    const status = screen.getByRole("status", { name: "Loading" });
    expect(status.className).toContain("reveal-delayed");
    expect(status.getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByRole("heading")).toBeNull();
  });
});
