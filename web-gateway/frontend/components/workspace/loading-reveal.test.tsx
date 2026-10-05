import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/components/landing/header", () => ({ Header: () => <header>site header</header> }));
vi.mock("@/components/landing/footer", () => ({ Footer: () => <footer>site footer</footer> }));

import JobDetailLoading from "@/app/workspace/[id]/loading";
import { ListSkeleton, OverviewSkeleton } from "@/components/admin/admin-skeletons";
import { DraftListSkeleton } from "./draft-list-skeleton";

afterEach(cleanup);

// A skeleton that carries `reveal-delayed` is invisible for the first 300 ms
// (app/globals.css), so a load that is fast enough shows no placeholder at all.
describe("skeletons wait before they show", () => {
  it("the snapshot draft list's", () => {
    render(<DraftListSkeleton />);
    expect(screen.getByRole("status").className).toContain("reveal-delayed");
  });

  it.each([
    ["the admin overview's", OverviewSkeleton],
    ["the admin lists'", ListSkeleton],
  ])("%s", (_name, Skeleton) => {
    render(<Skeleton />);
    expect(screen.getByRole("status").className).toContain("reveal-delayed");
  });

  it("a job page's keeps the header and footer on screen and delays only its body", () => {
    render(<JobDetailLoading />);
    const header = screen.getByText("site header");
    const footer = screen.getByText("site footer");
    const body = screen.getByRole("status", { name: "Loading snapshot draft" }).closest(".reveal-delayed")!;
    expect(body).not.toBeNull();
    expect(body.contains(header)).toBe(false);
    expect(body.contains(footer)).toBe(false);
    // Nothing of the header or footer sits inside a delayed element.
    expect(header.closest(".reveal-delayed")).toBeNull();
    expect(footer.closest(".reveal-delayed")).toBeNull();
  });
});
