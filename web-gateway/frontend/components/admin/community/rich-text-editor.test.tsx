import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Editor } from "@tiptap/core";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/community", useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { RichTextEditor } from "@/components/admin/community/rich-text-editor";
import { richTextExtensions } from "@/components/admin/community/rich-text-extensions";
import type { RichTextDoc, RichTextNode } from "@/lib/community/types";

afterEach(() => cleanup());

// A focused toolbar button opens its tooltip, which measures itself.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

// jsdom has no layout; ProseMirror asks for rectangles when it scrolls the selection into view.
if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
}

const doc = (...content: RichTextNode[]): RichTextDoc => ({ type: "doc", content });
const para = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });

describe("the editor's schema", () => {
  const editor = new Editor({ extensions: richTextExtensions("") });
  const nodes = Object.keys(editor.schema.nodes).sort();
  const marks = Object.keys(editor.schema.marks).sort();

  it("holds exactly the nodes the backend stores", () => {
    expect(nodes).toEqual(
      ["blockquote", "bulletList", "codeBlock", "doc", "hardBreak", "heading", "horizontalRule", "image", "listItem", "orderedList", "paragraph", "text"].sort()
    );
  });

  it("holds exactly the marks the backend stores", () => {
    expect(marks).toEqual(["bold", "code", "italic", "link", "strike", "underline"]);
  });

  it("makes a heading 1 into nothing it knows: only levels 2 and 3 exist", () => {
    const e = new Editor({ extensions: richTextExtensions(""), content: "<h1>Big</h1><h2>Two</h2><h4>Four</h4>" });
    const levels = (e.getJSON().content ?? []).filter((n) => n.type === "heading").map((n) => n.attrs?.level);
    expect(levels.every((l) => l === 2 || l === 3)).toBe(true);
  });

  it("refuses a javascript: link and a data: image on paste", () => {
    const e = new Editor({
      extensions: richTextExtensions(""),
      content: '<p><a href="javascript:alert(1)">x</a> <a href="https://a.org">ok</a></p><img src="data:image/png;base64,AAAA" alt="x">',
    });
    const json = JSON.stringify(e.getJSON());
    expect(json).not.toContain("javascript:");
    expect(json).not.toContain("data:image");
    expect(json).toContain("https://a.org");
  });
});

describe("the toolbar", () => {
  async function renderEditor(value: RichTextDoc | null = null, onChange = vi.fn()) {
    render(<RichTextEditor value={value} onChange={onChange} ariaLabel="Page text" />);
    await screen.findByRole("toolbar", { name: "Text formatting" });
    return onChange;
  }

  it("names every button and marks toggles with aria-pressed", async () => {
    await renderEditor();
    const names = [
      "Bold", "Italic", "Underline", "Strikethrough", "Inline code", "Heading", "Subheading", "Bulleted list",
      "Numbered list", "Callout", "Code block", "Divider", "Link", "Image", "Undo", "Redo",
    ];
    for (const name of names) expect(screen.getByRole("button", { name }), name).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bold" }).getAttribute("aria-pressed")).toBe("false");
    // A divider and the history buttons are actions, not toggles.
    expect(screen.getByRole("button", { name: "Divider" }).hasAttribute("aria-pressed")).toBe(false);
    expect(screen.getByRole("button", { name: "Undo" }).hasAttribute("aria-pressed")).toBe(false);
  });

  it("is one tab stop and moves along with the arrow keys", async () => {
    await renderEditor();
    const buttons = screen.getAllByRole("button");
    expect(buttons.filter((b) => b.tabIndex === 0)).toHaveLength(1);
    const bold = screen.getByRole("button", { name: "Bold" });
    act(() => bold.focus());
    fireEvent.keyDown(bold, { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Italic" }));
    fireEvent.keyDown(document.activeElement as Element, { key: "End" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Redo" }));
    fireEvent.keyDown(document.activeElement as Element, { key: "Home" });
    expect(document.activeElement).toBe(bold);
  });

  it("starts from the value, and reports the document with a heading added by the toolbar", async () => {
    const onChange = await renderEditor(doc(para("Hello")));
    const box = await screen.findByRole("textbox", { name: "Page text" });
    expect(box.textContent).toContain("Hello");
    fireEvent.click(screen.getByRole("button", { name: "Heading" }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const last = onChange.mock.calls.at(-1)?.[0] as RichTextDoc;
    expect(last.content?.[0]).toEqual({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Hello" }] });
    await waitFor(() => expect(screen.getByRole("button", { name: "Heading" }).getAttribute("aria-pressed")).toBe("true"));
  });

  it("adds a divider from the toolbar", async () => {
    const onChange = await renderEditor(doc(para("Hello")));
    const box = await screen.findByRole("textbox", { name: "Page text" });
    act(() => {
      (box as HTMLElement).focus();
    });
    fireEvent.click(screen.getByRole("button", { name: "Divider" }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const withRule = onChange.mock.calls.at(-1)?.[0] as RichTextDoc;
    expect(withRule.content?.some((n) => n.type === "horizontalRule")).toBe(true);
  });

  it("opens the link dialog and refuses an address the backend would", async () => {
    await renderEditor(doc(para("Hello")));
    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    const field = await screen.findByLabelText("Address");
    fireEvent.change(screen.getByLabelText("Link text"), { target: { value: "here" } });
    fireEvent.change(field, { target: { value: "javascript:alert(1)" } });
    fireEvent.click(screen.getByRole("button", { name: "Add link" }));
    expect(await screen.findByText(/Use an https:\/\/ address/)).toBeTruthy();
  });

  it("adds a link with the text and address given", async () => {
    const onChange = await renderEditor(doc(para("Hello")));
    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    fireEvent.change(await screen.findByLabelText("Link text"), { target: { value: "the site" } });
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "example.org" } });
    fireEvent.click(screen.getByRole("button", { name: "Add link" }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(JSON.stringify(onChange.mock.calls.at(-1)?.[0])).toContain('"href":"https://example.org"');
  });

  it("asks for the image's description before it adds one", async () => {
    const onChange = await renderEditor(doc(para("Hello")));
    fireEvent.click(screen.getByRole("button", { name: "Image" }));
    fireEvent.change(await screen.findByLabelText("Or image address"), { target: { value: "https://a.org/p.png" } });
    fireEvent.click(screen.getByRole("button", { name: "Add image" }));
    expect(await screen.findByText("Describe the image for people who can't see it.")).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Description for screen readers"), { target: { value: "A hall" } });
    fireEvent.change(screen.getByLabelText(/Caption/), { target: { value: "The hall" } });
    fireEvent.click(screen.getByRole("button", { name: "Add image" }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const image = (onChange.mock.calls.at(-1)?.[0] as RichTextDoc).content?.find((n) => n.type === "image");
    expect(image).toEqual({ type: "image", attrs: { src: "https://a.org/p.png", alt: "A hall", title: "The hall" } });
  });
});
