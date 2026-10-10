import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { RichTextDoc, RichTextNode } from "@/lib/community/types";
import { RichText, isRichTextEmpty } from "./rich-text";

afterEach(cleanup);

const doc = (...content: RichTextNode[]): RichTextDoc => ({ type: "doc", content });
const text = (t: string, marks?: RichTextNode["marks"]): RichTextNode => ({ type: "text", text: t, ...(marks ? { marks } : {}) });
const p = (...content: RichTextNode[]): RichTextNode => ({ type: "paragraph", content });
const link = (href: unknown) => [{ type: "link", attrs: { href } }];

function html(d: RichTextDoc | null | undefined) {
  const { container } = render(<RichText doc={d} />);
  return container;
}

describe("paragraphs", () => {
  it("makes the first paragraph the larger lead, and later ones body text", () => {
    const c = html(doc(p(text("First")), p(text("Second")), p(text("Third"))));
    const paras = c.querySelectorAll("p");
    expect(paras).toHaveLength(3);
    expect(paras[0].className).toContain("font-[550]");
    expect(paras[0].className).toContain("text-[clamp(19px,1.6vw,22px)]");
    expect(paras[1].className).not.toContain("font-[550]");
    expect(paras[2].className).not.toContain("font-[550]");
  });

  it("takes the first paragraph with text as the lead, past a heading and empty paragraphs", () => {
    const c = html(
      doc(
        { type: "heading", attrs: { level: 2 }, content: [text("Title")] },
        { type: "paragraph" },
        p(text("  ")),
        p(text("Real lead")),
        p(text("Body")),
      ),
    );
    const paras = [...c.querySelectorAll("p")];
    expect(paras.map((x) => x.textContent)).toEqual(["Real lead", "Body"]);
    expect(screen.getByText("Real lead").className).toContain("font-[550]");
    expect(screen.getByText("Body").className).not.toContain("font-[550]");
  });

  it("does not take a call-to-action link as the lead", () => {
    html(doc(p(text("Sign up", link("https://example.org/signup"))), p(text("Intro text"))));
    expect(screen.getByText("Intro text").className).toContain("font-[550]");
  });

  it("draws nothing for an empty paragraph", () => {
    const c = html(doc({ type: "paragraph" }, p(), p(text("")), p(text("   "))));
    expect(c.querySelectorAll("p")).toHaveLength(0);
  });

  it("renders a hard break as <br>", () => {
    const c = html(doc(p(text("one"), { type: "hardBreak" }, text("two"))));
    expect(c.querySelector("p")?.innerHTML).toBe("one<br>two");
  });
});

describe("marks", () => {
  it("wraps text in bold, italic, underline, strike and code", () => {
    const c = html(
      doc(
        p(
          text("b", [{ type: "bold" }]),
          text("i", [{ type: "italic" }]),
          text("u", [{ type: "underline" }]),
          text("s", [{ type: "strike" }]),
          text("c", [{ type: "code" }]),
        ),
      ),
    );
    expect(c.querySelector("strong")?.textContent).toBe("b");
    expect(c.querySelector("em")?.textContent).toBe("i");
    expect(c.querySelector("u")?.textContent).toBe("u");
    expect(c.querySelector("s")?.textContent).toBe("s");
    expect(c.querySelector("code")?.textContent).toBe("c");
  });

  it("combines marks on one piece of text", () => {
    const c = html(doc(p(text("both", [{ type: "bold" }, { type: "italic" }]))));
    expect(c.querySelector("strong em, em strong")?.textContent).toBe("both");
  });

  it("ignores a mark it does not know", () => {
    const c = html(doc(p(text("plain", [{ type: "highlight", attrs: { color: "red" } }]))));
    expect(c.querySelector("p")?.textContent).toBe("plain");
    expect(c.querySelector("mark")).toBeNull();
  });
});

describe("links", () => {
  it("opens an outside link in a new tab with rel noopener noreferrer", () => {
    html(doc(p(text("Intro")), p(text("see "), text("the site", link("https://example.org/x")), text(" now"))));
    const a = screen.getByRole("link", { name: "the site" });
    expect(a.getAttribute("href")).toBe("https://example.org/x");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("keeps a path on this site in the same tab", () => {
    html(doc(p(text("Intro")), p(text("go "), text("to the repository", link("/repository")), text("."))));
    const a = screen.getByRole("link", { name: "to the repository" });
    expect(a.getAttribute("href")).toBe("/repository");
    expect(a.getAttribute("target")).toBeNull();
    expect(a.getAttribute("rel")).toBeNull();
  });

  it("keeps a mailto link in the same tab", () => {
    html(doc(p(text("Intro")), p(text("write "), text("us", link("mailto:info@openghm.org")))));
    const a = screen.getByRole("link", { name: "us" });
    expect(a.getAttribute("href")).toBe("mailto:info@openghm.org");
    expect(a.getAttribute("target")).toBeNull();
  });

  it.each(["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,x", "//evil.example", "/\\evil.example", "ftp://x.org", "", null, 5])(
    "shows the text of a link to %j without linking it",
    (href) => {
      const c = html(doc(p(text("Intro")), p(text("before "), text("bad link", link(href)), text(" after"))));
      expect(screen.queryByRole("link")).toBeNull();
      expect(c.querySelector("a")).toBeNull();
      expect(screen.getByText(/before/).textContent).toContain("bad link");
    },
  );

  it("does not make a call-to-action of a link it will not follow", () => {
    const c = html(doc(p(text("Intro")), p(text("Click me", link("javascript:alert(1)")))));
    expect(c.querySelector("a")).toBeNull();
    expect(screen.getByText("Click me")).toBeTruthy();
  });
});

describe("the call-to-action card", () => {
  it("turns a paragraph that is only one link into a large link card", () => {
    html(doc(p(text("Intro")), p(text("Sign up for updates here!", link("https://example.org/signup")))));
    const a = screen.getByRole("link", { name: /Sign up for updates here!/ });
    expect(a.getAttribute("href")).toBe("https://example.org/signup");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    expect(a.className).toContain("bg-secondary");
    expect(a.className).toContain("text-[17px]");
    expect(a.closest("p")).toBeNull();
    expect(within(a).getByText("(opens in a new tab)")).toBeTruthy();
  });

  it("keeps a link on this site in the same tab", () => {
    html(doc(p(text("Intro")), p(text("Open the Workspace", link("/workspace")))));
    const a = screen.getByRole("link", { name: "Open the Workspace" });
    expect(a.getAttribute("target")).toBeNull();
    expect(a.className).toContain("bg-secondary");
  });

  it("is still a card when the link text is bold, and not a card when other text sits beside it", () => {
    html(
      doc(
        p(text("Intro")),
        p(text("Bold card", [{ type: "bold" }, ...link("https://example.org/a")])),
        p(text("not a card ", undefined), text("inline", link("https://example.org/b"))),
      ),
    );
    expect(screen.getByRole("link", { name: /Bold card/ }).className).toContain("bg-secondary");
    expect(screen.getByRole("link", { name: "inline" }).className).not.toContain("bg-secondary");
  });
});

describe("headings", () => {
  it("renders levels 2 and 3 as h2 and h3", () => {
    html(
      doc(
        { type: "heading", attrs: { level: 2 }, content: [text("Big")] },
        { type: "heading", attrs: { level: 3 }, content: [text("Small")] },
      ),
    );
    expect(screen.getByRole("heading", { level: 2, name: "Big" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: "Small" })).toBeTruthy();
  });

  it("keeps the h1 for the page: level 1 renders as h2, a deep level as h3", () => {
    html(
      doc(
        { type: "heading", attrs: { level: 1 }, content: [text("One")] },
        { type: "heading", attrs: { level: 5 }, content: [text("Five")] },
      ),
    );
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "One" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: "Five" })).toBeTruthy();
  });
});

describe("lists", () => {
  const item = (t: string) => ({ type: "listItem", content: [p(text(t))] });

  it("marks bullet items with an em dash", () => {
    html(doc({ type: "bulletList", content: [item("one"), item("two")] }));
    const list = screen.getByRole("list");
    expect(list.tagName).toBe("UL");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toBe("—one");
    expect(items[1].textContent).toBe("—two");
  });

  it("marks ordered items 01, 02, …", () => {
    html(doc({ type: "orderedList", content: [item("a"), item("b"), item("c")] }));
    const list = screen.getByRole("list");
    expect(list.tagName).toBe("OL");
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["01a", "02b", "03c"]);
  });

  it("starts an ordered list where its start says", () => {
    html(doc({ type: "orderedList", attrs: { start: 9 }, content: [item("a"), item("b"), item("c")] }));
    expect(within(screen.getByRole("list")).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["09a", "10b", "11c"]);
  });

  it("hides the mark from assistive technology", () => {
    const c = html(doc({ type: "bulletList", content: [item("one")] }));
    expect(c.querySelector("li > span")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("styles the text of an item as list text, not as a lead or body paragraph", () => {
    const c = html(doc({ type: "bulletList", content: [item("one")] }));
    expect(c.querySelector("li p")?.className ?? "").not.toContain("font-[550]");
    expect(c.querySelector("li p")?.className ?? "").not.toContain("max-w-[720px]");
  });

  it("nests a list inside an item", () => {
    html(
      doc({
        type: "bulletList",
        content: [{ type: "listItem", content: [p(text("outer")), { type: "orderedList", content: [item("inner")] }] }],
      }),
    );
    const lists = screen.getAllByRole("list");
    expect(lists).toHaveLength(2);
    expect(within(lists[1]).getByText("inner")).toBeTruthy();
    expect(within(lists[1]).getByText("01")).toBeTruthy();
  });

  it("ignores children of a list that are not items", () => {
    html(doc({ type: "bulletList", content: [p(text("stray")), item("real")] }));
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });
});

describe("blockquote, code, rule", () => {
  it("renders a blockquote as a callout around its paragraphs", () => {
    const c = html(doc(p(text("Intro")), { type: "blockquote", content: [p(text("Careful"), text(" now", [{ type: "bold" }]))] }));
    const q = c.querySelector("blockquote");
    expect(q).not.toBeNull();
    expect(q?.className).toContain("bg-warning/10");
    expect(q?.textContent).toBe("Careful now");
    expect(within(q as HTMLElement).getByText("now").tagName).toBe("STRONG");
  });

  it("renders a code block as plain text in <pre><code>, without interpreting it", () => {
    const c = html(doc({ type: "codeBlock", content: [text("import openghm as og\n<b>not bold</b>")] }));
    const code = c.querySelector("pre > code");
    expect(code?.textContent).toBe("import openghm as og\n<b>not bold</b>");
    expect(c.querySelector("pre b")).toBeNull();
  });

  it("renders a horizontal rule", () => {
    const c = html(doc(p(text("a")), { type: "horizontalRule" }, p(text("b"))));
    expect(c.querySelectorAll("hr")).toHaveLength(1);
  });
});

describe("images", () => {
  it("renders a figure with the title as its caption", () => {
    const c = html(
      doc({
        type: "image",
        attrs: { src: "/api/community/files/65f1a2b3c4d5e6f708192a3b", alt: "The group", title: "Everyone in the room" },
      }),
    );
    const fig = c.querySelector("figure");
    expect(fig).not.toBeNull();
    const img = fig?.querySelector("img");
    expect(img?.getAttribute("src")).toBe("/api/community/files/65f1a2b3c4d5e6f708192a3b");
    expect(img?.getAttribute("alt")).toBe("The group");
    expect(fig?.querySelector("figcaption")?.textContent).toBe("Everyone in the room");
  });

  it("has no caption without a title, and an empty alt without alt text", () => {
    const c = html(doc({ type: "image", attrs: { src: "https://example.org/a.png" } }));
    expect(c.querySelector("figcaption")).toBeNull();
    expect(c.querySelector("img")?.getAttribute("alt")).toBe("");
  });

  it.each(["javascript:alert(1)", "data:image/svg+xml,<svg>", "http://example.org/a.png", "//evil.example/a.png", "", 5])(
    "draws no figure at all for the source %j",
    (src) => {
      const c = html(doc({ type: "image", attrs: { src, title: "caption" } }));
      expect(c.querySelector("figure")).toBeNull();
      expect(c.querySelector("img")).toBeNull();
      expect(c.textContent).toBe("");
    },
  );

  it("does not put a figure inside a paragraph", () => {
    const c = html(doc(p(text("before"), { type: "image", attrs: { src: "https://example.org/a.png", title: "c" } })));
    expect(c.querySelector("p figure")).toBeNull();
    expect(c.querySelector("figure")).not.toBeNull();
  });
});

describe("what it will not trust", () => {
  it("renders a node it does not know as its children, or as nothing", () => {
    const c = html(
      doc(
        { type: "callout", content: [p(text("inside"))] },
        { type: "embed", attrs: { src: "https://evil.example" } },
        { type: "script", content: [text("alert(1)")] },
      ),
    );
    expect(screen.getByText("inside")).toBeTruthy();
    expect(c.querySelector("script, iframe, embed")).toBeNull();
    expect(c.textContent).toContain("inside");
  });

  it("puts markup in text on the page as text", () => {
    const c = html(doc(p(text("<img src=x onerror=alert(1)><script>alert(2)</script>"))));
    expect(c.querySelector("img, script")).toBeNull();
    expect(c.textContent).toBe("<img src=x onerror=alert(1)><script>alert(2)</script>");
  });

  it("does not set innerHTML from the document: attributes it does not use are ignored", () => {
    const c = html(doc({ type: "paragraph", attrs: { class: "x", onclick: "alert(1)", dangerouslySetInnerHTML: { __html: "<b>x</b>" } }, content: [text("safe")] }));
    expect(c.querySelector("b")).toBeNull();
    expect(c.querySelector("[onclick]")).toBeNull();
  });

  it.each([null, undefined, {}, { type: "doc" }, { type: "doc", content: [] }, { type: "doc", content: "oops" }])(
    "renders nothing, without throwing, for %j",
    (d) => {
      const c = html(d as RichTextDoc | null | undefined);
      expect(c.textContent).toBe("");
    },
  );

  it("survives a hand-edited document: null children, text without text, marks that are not a list", () => {
    const bad = {
      type: "doc",
      content: [null, 5, "x", { type: "paragraph", content: [null, { type: "text" }, { type: "text", text: "ok", marks: "bold" }] }],
    } as unknown as RichTextDoc;
    const c = html(bad);
    expect(c.textContent).toBe("ok");
  });

  it("stops at a sensible depth instead of overflowing the stack", () => {
    let node: RichTextNode = p(text("deep"));
    for (let i = 0; i < 200; i++) node = { type: "blockquote", content: [node] };
    expect(() => html(doc(node))).not.toThrow();
  });
});

describe("isRichTextEmpty", () => {
  it("is true for no document, a blank editor and a document of empty paragraphs", () => {
    expect(isRichTextEmpty(null)).toBe(true);
    expect(isRichTextEmpty(undefined)).toBe(true);
    expect(isRichTextEmpty(doc())).toBe(true);
    expect(isRichTextEmpty(doc({ type: "paragraph" }))).toBe(true);
    expect(isRichTextEmpty(doc(p(text(""))))).toBe(true);
  });

  it("is false once there is text, an image or a rule", () => {
    expect(isRichTextEmpty(doc(p(text("hi"))))).toBe(false);
    expect(isRichTextEmpty(doc({ type: "image", attrs: { src: "https://example.org/a.png" } }))).toBe(false);
    expect(isRichTextEmpty(doc({ type: "horizontalRule" }))).toBe(false);
  });
});

describe("className", () => {
  it("is passed to the wrapper", () => {
    const { container } = render(<RichText doc={doc(p(text("x")))} className="max-w-[760px]" />);
    expect((container.firstChild as HTMLElement).className).toContain("max-w-[760px]");
  });
});
