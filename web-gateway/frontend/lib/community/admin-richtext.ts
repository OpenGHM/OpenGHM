/**
 * The rich-text document an admin writes, checked the way the backend checks it
 * (app/services/community_content.py): which nodes and marks exist, which
 * addresses a link or an image may carry, and how big the stored document may
 * be. The editor runs a document through `normalizeDoc` before it hands it on,
 * so what the form holds is what the backend will accept; the backend still
 * validates every write.
 */
import type { RichTextDoc, RichTextNode } from "@/lib/community/types";

/** The most the backend stores for one document, serialized. */
export const MAX_RICH_TEXT_BYTES = 512 * 1024;

/** An uploaded file, as content stores its address: `/api/community/files/<24 hex>`. */
const UPLOADED_FILE_URL = /^\/api\/community\/files\/[0-9a-f]{24}$/;

const NODE_TYPES = new Set([
  "doc",
  "paragraph",
  "text",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "hardBreak",
  "image",
]);

const MARK_TYPES = new Set(["bold", "italic", "underline", "strike", "code", "link"]);

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const UNSAFE_CHARS = /[\u0000-\u001f\u007f\s\\]/;

/** A link address the backend accepts: `http(s)://`, `mailto:`, or a path on
 *  this site starting with a single `/`. */
export function isAllowedLinkHref(href: string): boolean {
  if (!href || UNSAFE_CHARS.test(href)) return false;
  if (href.startsWith("/")) return !href.startsWith("//") && !href.startsWith("/\\");
  return /^(https?:\/\/[^/]|mailto:.)/i.test(href);
}

/** An image address the backend accepts: `https://`, or an uploaded file. */
export function isAllowedImageSrc(src: string): boolean {
  if (!src || UNSAFE_CHARS.test(src)) return false;
  return /^https:\/\/[^/]/i.test(src) || UPLOADED_FILE_URL.test(src);
}

/**
 * What a person typed into a link field, as an address the editor may store:
 * an address with a scheme stays as it is (and must be allowed), an email
 * address gets `mailto:`, a bare domain gets `https://`, and a path starting
 * with `/` stays. Null when it is none of these.
 */
export function normalizeLinkInput(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  if (text.startsWith("/") || SCHEME.test(text)) return isAllowedLinkHref(text) ? text : null;
  if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(text)) return `mailto:${text}`;
  if (/^[^\s/@]+\.[^\s/@.]{2,}(?:[/?#]\S*)?$/.test(text)) return `https://${text}`;
  return null;
}

/** Whether a node, or anything inside it, is something a reader would see. An
 *  empty paragraph, a hard break and whitespace are not. */
function hasContent(node: RichTextNode): boolean {
  if (node.type === "text") return Boolean(node.text && node.text.trim());
  if (node.type === "image" || node.type === "horizontalRule") return true;
  return (node.content ?? []).some(hasContent);
}

/** Whether the document has nothing in it a reader would see. */
export function isEmptyDoc(doc: RichTextDoc | null | undefined): boolean {
  if (!doc) return true;
  return !(doc.content ?? []).some(hasContent);
}

function cleanMarks(marks: RichTextNode["marks"]): RichTextNode["marks"] {
  const out: NonNullable<RichTextNode["marks"]> = [];
  for (const mark of marks ?? []) {
    if (!MARK_TYPES.has(mark.type)) continue;
    if (mark.type === "link") {
      const href = mark.attrs?.href;
      // A link the backend would refuse is dropped; its text stays.
      if (typeof href === "string" && isAllowedLinkHref(href)) out.push({ type: "link", attrs: { href } });
    } else {
      out.push({ type: mark.type });
    }
  }
  return out.length > 0 ? out : undefined;
}

function cleanNode(node: RichTextNode): RichTextNode | null {
  if (!NODE_TYPES.has(node.type)) return null;

  if (node.type === "text") {
    if (!node.text) return null;
    const marks = cleanMarks(node.marks);
    return marks ? { type: "text", text: node.text, marks } : { type: "text", text: node.text };
  }

  if (node.type === "image") {
    const src = node.attrs?.src;
    if (typeof src !== "string" || !isAllowedImageSrc(src)) return null;
    const attrs: Record<string, unknown> = { src };
    for (const key of ["alt", "title"] as const) {
      const value = node.attrs?.[key];
      if (typeof value === "string" && value.trim()) attrs[key] = value;
    }
    return { type: "image", attrs };
  }

  const out: RichTextNode = { type: node.type };
  if (node.type === "heading") {
    out.attrs = { level: node.attrs?.level === 3 ? 3 : 2 };
  }
  if (node.content) {
    const content = node.content.map(cleanNode).filter((n): n is RichTextNode => n !== null);
    if (content.length > 0) out.content = content;
  }
  return out;
}

/**
 * The document with only what the backend allows: unknown nodes and marks
 * dropped, attributes cut down to the ones the schema names (`level`, `href`,
 * `src`, `alt`, `title`), and links and images with a refused address removed.
 * Null when nothing a reader would see is left, which is how an empty body is
 * stored.
 */
export function normalizeDoc(doc: RichTextDoc | null | undefined): RichTextDoc | null {
  if (!doc || isEmptyDoc(doc)) return null;
  const content = (doc.content ?? []).map(cleanNode).filter((n): n is RichTextNode => n !== null);
  const cleaned: RichTextDoc = { type: "doc", content };
  return isEmptyDoc(cleaned) ? null : cleaned;
}

/** Whether the serialized document is over what the backend stores. */
export function isRichTextTooLarge(doc: RichTextDoc | null | undefined): boolean {
  if (!doc) return false;
  return new TextEncoder().encode(JSON.stringify(doc)).length > MAX_RICH_TEXT_BYTES;
}
