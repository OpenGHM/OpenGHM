import { ArrowRight, ArrowUpRight } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { CmsImage } from "@/components/community/cms-image";
import { isExternalHref, safeHref, safeImageSrc } from "@/lib/community/links";
import type { RichTextDoc, RichTextNode } from "@/lib/community/types";
import { cn } from "@/lib/utils";

/**
 * Renders a Community rich-text document (Tiptap / ProseMirror JSON) as React
 * elements, in the look of the design's Workshop Detail page. It never builds
 * HTML from a string: every node type it knows becomes an element, and a type
 * it does not know (the backend refuses those on write, but a document can
 * still arrive some other way) renders its children or nothing.
 *
 * - The first paragraph with text is the larger "lead".
 * - A paragraph whose only content is one link is a call-to-action card.
 * - A bullet item is marked "—", an ordered item "01", "02", ….
 * - A blockquote is an amber callout, an image a figure whose title is its caption.
 * - Every link is checked again here (`safeHref`): `http(s)`, `mailto` and
 *   paths on this site only; an address outside those shows its text unlinked.
 *   A link that leaves the site opens in a new tab with `rel="noopener noreferrer"`.
 *
 * It has no state, so it runs on the server and in the browser alike; the
 * public pages and the admin editor's preview use this one component.
 */
export function RichText({ doc, className }: { doc: RichTextDoc | RichTextNode | null | undefined; className?: string }) {
  const blocks = doc ? children(doc) : [];
  const leadIndex = blocks.findIndex((b) => b.type === "paragraph" && !isCta(b) && hasContent(b));
  return (
    <div className={cn("flex flex-col gap-[18px]", className)}>
      {blocks.map((block, i) => renderBlock(block, i, { lead: i === leadIndex, depth: 0 }))}
    </div>
  );
}

/** Whether a document shows anything: some text, an image or a rule. A blank editor saves one empty paragraph. */
export function isRichTextEmpty(doc: RichTextDoc | RichTextNode | null | undefined): boolean {
  return !doc || !hasContent(doc);
}

// ---- Structure --------------------------------------------------------------

/** How deep a document may nest before the renderer stops: the editor never goes near it. */
const MAX_DEPTH = 24;

interface Ctx {
  /** This paragraph is the lead. */
  lead: boolean;
  depth: number;
  /** Inside a list item or a quote: a paragraph takes the surrounding text style. */
  within?: "item" | "quote";
  /** A list inside a list item: no rules, a smaller mark. */
  nested?: boolean;
}

/** The child nodes, leaving out anything that is not an object (a hand-edited document). */
function children(node: RichTextNode): RichTextNode[] {
  return Array.isArray(node.content)
    ? node.content.filter((c) => c !== null && typeof c === "object")
    : [];
}

function hasContent(node: RichTextNode): boolean {
  if (node.type === "text") return typeof node.text === "string" && node.text.trim().length > 0;
  if (node.type === "image") return typeof node.attrs?.src === "string";
  if (node.type === "horizontalRule") return true;
  return children(node).some(hasContent);
}

function marksOf(node: RichTextNode): NonNullable<RichTextNode["marks"]> {
  return Array.isArray(node.marks) ? node.marks.filter((m) => m && typeof m === "object") : [];
}

/** The link a text node carries, when it carries one that is safe. */
function linkOf(node: RichTextNode): string | null {
  const mark = marksOf(node).find((m) => m.type === "link");
  return mark ? safeHref(mark.attrs?.href) : null;
}

/** A paragraph whose only content is one linked piece of text. */
function isCta(node: RichTextNode): boolean {
  if (node.type !== "paragraph") return false;
  const parts = children(node).filter((c) => !(c.type === "text" && !c.text));
  return parts.length === 1 && parts[0].type === "text" && linkOf(parts[0]) !== null;
}

function plainText(node: RichTextNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  return children(node).map(plainText).join("");
}

// ---- Blocks -----------------------------------------------------------------

function renderBlock(node: RichTextNode, key: number, ctx: Ctx): ReactNode {
  if (!node || typeof node !== "object" || ctx.depth > MAX_DEPTH) return null;
  const next: Ctx = { lead: false, depth: ctx.depth + 1, within: ctx.within };

  switch (node.type) {
    case "paragraph":
      return renderParagraph(node, key, ctx);

    case "heading": {
      const level = Number(node.attrs?.level) <= 2 ? 2 : 3;
      const Tag = level === 2 ? "h2" : "h3";
      return (
        <Tag
          key={key}
          className={cn(
            "-mb-1 font-semibold leading-[1.3] tracking-[-0.02em] text-foreground",
            level === 2 ? "mt-3.5 text-[19px]" : "mt-2 text-[17px]",
          )}
        >
          {renderInline(children(node))}
        </Tag>
      );
    }

    case "bulletList":
    case "orderedList":
      return renderList(node, key, ctx);

    case "blockquote":
      return (
        <blockquote
          key={key}
          className="flex max-w-[720px] items-baseline gap-3 rounded-[14px] bg-warning/10 px-[18px] py-4 text-[15px] leading-[1.6] text-warning [&_a]:text-warning [&_a]:decoration-warning/40"
        >
          <span aria-hidden="true" className="size-2 shrink-0 -translate-y-px rounded-full bg-warning/70" />
          <div className="flex min-w-0 flex-col gap-2 text-pretty">
            {children(node).map((c, i) => renderBlock(c, i, { ...next, within: "quote" }))}
          </div>
        </blockquote>
      );

    case "codeBlock":
      return (
        <pre
          key={key}
          tabIndex={0}
          className="max-w-full overflow-x-auto rounded-xl bg-hero p-4 font-mono text-[13px] leading-relaxed text-hero-text focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <code>{plainText(node)}</code>
        </pre>
      );

    case "horizontalRule":
      return <hr key={key} className="my-2 border-border" />;

    case "image":
      return renderImage(node, key);

    case "text":
    case "hardBreak":
      // Inline nodes found where a block is expected: show them as a paragraph.
      return renderParagraph({ type: "paragraph", content: [node] }, key, ctx);

    default:
      // A node type this renderer does not know: its children, or nothing.
      return children(node).length > 0 ? (
        <div key={key} className="contents">
          {children(node).map((c, i) => renderBlock(c, i, next))}
        </div>
      ) : null;
  }
}

function renderParagraph(node: RichTextNode, key: number, ctx: Ctx): ReactNode {
  if (!hasContent(node)) return null;

  const parts = children(node);
  if (ctx.depth === 0 && isCta(node)) {
    const text = parts.find((c) => c.type === "text") as RichTextNode;
    const href = linkOf(text) as string;
    const external = isExternalHref(href);
    const Icon = external ? ArrowUpRight : ArrowRight;
    return (
      <a
        key={key}
        href={href}
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        className="mt-2 flex items-center justify-between gap-4 rounded-2xl bg-secondary px-6 py-5 text-[17px] font-semibold tracking-[-0.01em] text-secondary-foreground transition-[filter] hover:brightness-95 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <span className="min-w-0 text-pretty">
          {text.text}
          {external && <span className="sr-only"> (opens in a new tab)</span>}
        </span>
        <Icon aria-hidden="true" className="size-[18px] shrink-0" />
      </a>
    );
  }

  // An image inside a paragraph is a block; a <figure> may not sit in a <p>.
  const holdsBlock = parts.some((c) => c.type === "image");
  const Tag = holdsBlock ? "div" : "p";
  const style = ctx.within
    ? ""
    : ctx.lead
      ? "mb-1 max-w-[720px] text-[clamp(19px,1.6vw,22px)] leading-[1.45] font-[550] tracking-[-0.015em] text-foreground text-pretty"
      : "max-w-[720px] text-base leading-[1.65] text-foreground/90 text-pretty";
  return (
    <Tag key={key} className={style || undefined}>
      {holdsBlock
        ? parts.map((c, i) => (c.type === "image" ? renderImage(c, i) : <p key={i}>{renderInline([c])}</p>))
        : renderInline(parts)}
    </Tag>
  );
}

function renderList(node: RichTextNode, key: number, ctx: Ctx): ReactNode {
  const ordered = node.type === "orderedList";
  const Tag = ordered ? "ol" : "ul";
  const start = Number(node.attrs?.start) > 0 ? Number(node.attrs?.start) : 1;
  const items = children(node).filter((c) => c.type === "listItem");
  const nested = ctx.within === "item";
  return (
    <Tag key={key} className={cn("flex flex-col", nested ? "mt-1.5" : "max-w-[720px]")}>
      {items.map((item, i) => {
        const mark = ordered ? String(start + i).padStart(2, "0") : "—";
        return (
          <li
            key={i}
            className={cn(
              "grid grid-cols-[44px_minmax(0,1fr)] items-baseline gap-x-3.5",
              nested ? "py-1" : "border-t border-border py-3.5",
              !nested && i === items.length - 1 && "border-b",
            )}
          >
            <span aria-hidden="true" className="font-mono text-[13px] text-primary">
              {mark}
            </span>
            <div className="flex min-w-0 flex-col gap-2 text-base leading-normal text-foreground/90 text-pretty">
              {children(item).map((c, j) => renderBlock(c, j, { lead: false, depth: ctx.depth + 2, within: "item" }))}
            </div>
          </li>
        );
      })}
    </Tag>
  );
}

function renderImage(node: RichTextNode, key: number): ReactNode {
  const src = safeImageSrc(node.attrs?.src);
  // An address that is not safe to load draws nothing, and no empty figure either.
  if (!src) return null;
  const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : "";
  const caption = typeof node.attrs?.title === "string" ? node.attrs.title.trim() : "";
  return (
    <figure key={key} className="my-1.5 flex flex-col gap-2.5">
      <div className="overflow-hidden rounded-2xl bg-accent">
        <CmsImage src={src} alt={alt} className="block h-auto w-full" />
      </div>
      {caption && <figcaption className="text-[13px] leading-normal text-muted-foreground">{caption}</figcaption>}
    </figure>
  );
}

// ---- Inline -----------------------------------------------------------------

function renderInline(nodes: RichTextNode[]): ReactNode[] {
  return nodes.map((node, i) => {
    if (node.type === "hardBreak") return <br key={i} />;
    if (node.type === "text") return renderText(node, i);
    // An unknown inline node: whatever text it holds.
    return <span key={i}>{renderInline(children(node))}</span>;
  });
}

function renderText(node: RichTextNode, key: number): ReactNode {
  if (!node.text) return null;
  const marks = new Set(marksOf(node).map((m) => m.type));
  let el: ReactNode = node.text;
  if (marks.has("code")) {
    el = <code className="rounded-md bg-muted px-1.5 py-px font-mono text-[0.9em]">{el}</code>;
  }
  if (marks.has("bold")) el = <strong className="font-semibold">{el}</strong>;
  if (marks.has("italic")) el = <em>{el}</em>;
  if (marks.has("underline")) el = <u>{el}</u>;
  if (marks.has("strike")) el = <s>{el}</s>;
  const href = linkOf(node);
  if (href) {
    const external = isExternalHref(href);
    el = (
      <a
        href={href}
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        className="font-medium text-primary underline decoration-primary/30 underline-offset-[3px] transition-colors hover:text-primary-hover hover:decoration-current"
      >
        {el}
      </a>
    );
  }
  return <Fragment key={key}>{el}</Fragment>;
}
