import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DownloadCard } from "@/components/repository/download-card";

beforeEach(() => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});
afterEach(cleanup);

const ITEMS = [
  { label: "Model snapshot tree", url: "https://s3.example/snapshots/abc/", isFile: false },
  { label: "metadata.json", url: "https://s3.example/snapshots/abc/metadata.json", isFile: true },
];

describe("DownloadCard", () => {
  it("links a file, leaves a tree as text, and copies each URL by its own button", async () => {
    render(<DownloadCard items={ITEMS} />);

    expect(screen.getByRole("link", { name: ITEMS[1].url }).getAttribute("href")).toBe(ITEMS[1].url);
    expect(screen.queryByRole("link", { name: ITEMS[0].url })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Copy Model snapshot tree" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(ITEMS[0].url);
    expect(await screen.findByText("Copied")).toBeTruthy();
  });

  it("shows the CLI command and the Browse files link only when it is given them", async () => {
    const { rerender } = render(<DownloadCard items={ITEMS} />);
    expect(screen.queryByText("CLI")).toBeNull();
    expect(screen.queryByRole("link", { name: "Browse files" })).toBeNull();
    expect(screen.getByText(/sha256sum -c SHA256SUMS/)).toBeTruthy();

    rerender(<DownloadCard items={ITEMS} command="openghm snapshot fetch abc" browseHref="/repository/abc/files" />);
    expect(screen.getByText("CLI")).toBeTruthy();
    expect(screen.getByText("openghm snapshot fetch abc")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Browse files" }).getAttribute("href")).toBe("/repository/abc/files");
    fireEvent.click(screen.getByRole("button", { name: "Copy command" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("openghm snapshot fetch abc");
    expect(await screen.findByText("Copied")).toBeTruthy();
  });
});
