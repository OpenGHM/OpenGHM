import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PhotoGallery } from "./photo-gallery";

afterEach(cleanup);

const PHOTOS = [
  { url: "https://example.org/1.jpg", caption: "Opening session" },
  { url: "https://example.org/2.jpg", caption: null },
  { url: "/api/community/files/65f1a2b3c4d5e6f708192a3b", caption: "Group photo" },
];

function open(i: number) {
  fireEvent.click(screen.getAllByRole("button", { name: /^Open photo/ })[i]);
  return screen.getByRole("dialog");
}

describe("PhotoGallery", () => {
  it("shows a count and a thumbnail button per photo", () => {
    render(<PhotoGallery photos={PHOTOS} />);
    expect(screen.getByRole("heading", { name: "Photos" })).toBeTruthy();
    expect(screen.getByText("3 photos")).toBeTruthy();
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Open photo 1 of 3: Opening session",
      "Open photo 2 of 3",
      "Open photo 3 of 3: Group photo",
    ]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says '1 photo' for one", () => {
    render(<PhotoGallery photos={[PHOTOS[0]]} />);
    expect(screen.getByText("1 photo")).toBeTruthy();
  });

  it("renders nothing without photos, and leaves out a photo whose address is not safe", () => {
    const { container, rerender } = render(<PhotoGallery photos={[]} />);
    expect(container.textContent).toBe("");
    rerender(<PhotoGallery photos={[PHOTOS[0], { url: "javascript:alert(1)", caption: "bad" }]} />);
    expect(screen.getByText("1 photo")).toBeTruthy();
  });

  it("opens the lightbox on the chosen photo with its count and caption", () => {
    render(<PhotoGallery photos={PHOTOS} />);
    const dialog = open(1);
    expect(within(dialog).getByText("2 / 3")).toBeTruthy();
    const img = within(dialog).getByRole("img");
    expect(img.getAttribute("src")).toBe("https://example.org/2.jpg");
    // No caption: the picture is still named.
    expect(img.getAttribute("alt")).toBe("Photo 2 of 3");
    expect(screen.getByRole("dialog", { name: "Photo 2 of 3" })).toBeTruthy();
  });

  it("steps with the arrow keys and wraps at both ends", () => {
    render(<PhotoGallery photos={PHOTOS} />);
    const dialog = open(0);
    expect(within(dialog).getByText("1 / 3")).toBeTruthy();
    expect(within(dialog).getByText("Opening session")).toBeTruthy();

    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(within(dialog).getByText("2 / 3")).toBeTruthy();
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(within(dialog).getByText("3 / 3")).toBeTruthy();
    expect(within(dialog).getByText("Group photo")).toBeTruthy();
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(within(dialog).getByText("1 / 3")).toBeTruthy();
    fireEvent.keyDown(dialog, { key: "ArrowLeft" });
    expect(within(dialog).getByText("3 / 3")).toBeTruthy();
  });

  it("steps with the Previous and Next buttons", () => {
    render(<PhotoGallery photos={PHOTOS} />);
    const dialog = open(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Next photo" }));
    expect(within(dialog).getByText("2 / 3")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Previous photo" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Previous photo" }));
    expect(within(dialog).getByText("3 / 3")).toBeTruthy();
  });

  it("closes on Escape and on the Close button", () => {
    render(<PhotoGallery photos={PHOTOS} />);
    let dialog = open(0);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();

    dialog = open(2);
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on a click beside the picture, but not on the picture or the buttons", () => {
    render(<PhotoGallery photos={PHOTOS} />);
    const dialog = open(0);
    fireEvent.click(within(dialog).getByRole("img"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Next photo" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(dialog);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("returns focus to the thumbnail it ended on", async () => {
    render(<PhotoGallery photos={PHOTOS} />);
    const dialog = open(0);
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    const thumbs = screen.getAllByRole("button", { name: /^Open photo/ });
    await waitFor(() => expect(document.activeElement).toBe(thumbs[1]));
  });

  it("has no Previous or Next with a single photo, and the arrow keys do nothing", () => {
    render(<PhotoGallery photos={[PHOTOS[0]]} />);
    const dialog = open(0);
    expect(within(dialog).queryByRole("button", { name: "Next photo" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Previous photo" })).toBeNull();
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(within(dialog).getByText("1 / 1")).toBeTruthy();
  });
});
