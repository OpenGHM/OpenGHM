import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RecentSnapshots } from "@/components/workspace/recent-snapshots";
import { fakeDataset } from "@/lib/workspace/fixtures";

afterEach(cleanup);

const LONG_TITLE =
  "WBM v1.0.0 Global_tracking simulation for 'Water balance model (WBM) v.1.0.0: a scalable gridded global hydrologic model with water-tracking functionality': [Global] [2000-2009]";
const LONG = fakeDataset({ id: "long", about: { ...fakeDataset().about, name: LONG_TITLE } });
const SHORT = fakeDataset({ id: "short", about: { ...fakeDataset().about, name: "Short" } });

describe("the snapshots you've used", () => {
  it("clamps a title to two lines, with the whole of it in the title attribute", () => {
    render(<RecentSnapshots snapshots={[LONG, SHORT]} onSelect={vi.fn()} />);
    const title = screen.getByText(LONG_TITLE);
    expect(title.className).toContain("line-clamp-2");
    expect(title.getAttribute("title")).toBe(LONG_TITLE);
  });

  it("makes the cards of a row the same height, with the period and resolution at the foot", () => {
    render(<RecentSnapshots snapshots={[LONG, SHORT]} onSelect={vi.fn()} />);
    const buttons = screen.getAllByRole("button");
    for (const button of buttons) {
      expect(button.className).toContain("h-full");
      const foot = button.querySelector(".mt-auto");
      expect(foot?.textContent).toContain("2001");
      expect(foot?.textContent).toContain("·");
    }
  });

  it("hands the snapshot to onSelect, and is off while one is pending", () => {
    const onSelect = vi.fn();
    const { rerender } = render(<RecentSnapshots snapshots={[SHORT]} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "Start from Short" }));
    expect(onSelect).toHaveBeenCalledWith(SHORT);

    rerender(<RecentSnapshots snapshots={[SHORT]} onSelect={onSelect} pendingId="short" disabled />);
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button").getAttribute("aria-busy")).toBe("true");
  });
});
