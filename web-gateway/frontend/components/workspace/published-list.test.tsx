import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const { fetchMine, redirectToSignIn } = vi.hoisted(() => ({
  fetchMine: vi.fn(),
  // The real one is `never`: it throws Next's redirect.
  redirectToSignIn: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
}));
vi.mock("@/lib/repository/actions", () => ({ fetchMine }));
vi.mock("@/lib/auth-guard", () => ({
  redirectToSignIn,
  isUnauthorizedError: (e: unknown) =>
    (e as { response?: { status?: number } })?.response?.status === 401,
}));

import { modelInputItem, snapshotItem } from "@/components/repository/catalogue.fixtures";
import { PublishedList, PublishedListSkeleton, PublishedLoadError } from "./published-list";
import { PublishedSection } from "./published-section";

afterEach(cleanup);
beforeEach(() => {
  fetchMine.mockReset();
  redirectToSignIn.mockClear();
});

describe("the published list", () => {
  it("shows one card per item, each opening its detail page, under a count", () => {
    render(<PublishedList items={[snapshotItem(), modelInputItem()]} />);
    expect(screen.getByText("2 published")).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Global Storage Run" }).getAttribute("href")).toBe("/repository/snap-1");
    expect(screen.getByRole("link", { name: "Ancillary Data v1" }).getAttribute("href")).toBe(
      "/repository/model-inputs/mi-1"
    );
    expect(screen.getByText("Model Snapshot")).toBeTruthy();
    expect(screen.getByText("Model Input")).toBeTruthy();
  });

  it("keeps the order it is given", () => {
    render(<PublishedList items={[modelInputItem(), snapshotItem()]} />);
    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual([
      "Ancillary Data v1",
      "Global Storage Run",
    ]);
  });

  it("lays the cards out in the grid the repository's grid view uses", () => {
    render(<PublishedList items={[snapshotItem()]} />);
    expect(screen.getByRole("list").className).toContain("md:grid-cols-2 xl:grid-cols-3");
  });

  it("has no filter buttons on a card and no publish action", () => {
    render(<PublishedList items={[snapshotItem()]} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link", { name: /publish/i })).toBeNull();
  });

  it("says nothing is published yet, with no button, when the list is empty", () => {
    render(<PublishedList items={[]} />);
    expect(screen.getByText("Nothing published yet")).toBeTruthy();
    expect(
      screen.getByText(
        "When a simulation finishes, you will be able to publish it as a model snapshot from its page."
      )
    ).toBeTruthy();
    expect(screen.queryByText(/published$/)).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("has a loading state announced once, as busy", () => {
    render(<PublishedListSkeleton />);
    expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");
  });

  it("has an error state that offers the page again", () => {
    render(<PublishedLoadError retryHref="/workspace/published" />);
    expect(screen.getByRole("alert").textContent).toContain("Couldn't load what you published.");
    expect(screen.getByRole("link", { name: "Try again" }).getAttribute("href")).toBe("/workspace/published");
  });
});

describe("the published section", () => {
  it("lists what the backend returned", async () => {
    fetchMine.mockResolvedValue({ items: [snapshotItem(), modelInputItem()] });
    render(await PublishedSection({ here: "/workspace/published" }));
    expect(screen.getByText("2 published")).toBeTruthy();
  });

  it("shows the empty state for an empty answer", async () => {
    fetchMine.mockResolvedValue({ items: [] });
    render(await PublishedSection({ here: "/workspace/published" }));
    expect(screen.getByText("Nothing published yet")).toBeTruthy();
  });

  it("shows the error state, not an empty list, when the backend fails", async () => {
    fetchMine.mockRejectedValue(new Error("Network Error"));
    render(await PublishedSection({ here: "/workspace/published" }));
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByText("Nothing published yet")).toBeNull();
  });

  it("sends a 401 to sign in, and back here afterwards", async () => {
    fetchMine.mockRejectedValue({ response: { status: 401 } });
    await expect(PublishedSection({ here: "/workspace/published" })).rejects.toThrow(
      "redirect:/workspace/published"
    );
    expect(redirectToSignIn).toHaveBeenCalledWith("/workspace/published");
  });
});
