import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import StarterKit from "@tiptap/starter-kit";
import { isAllowedLinkHref } from "@/lib/community/admin-richtext";

/** A bare domain ("example.org/page") that autolink may turn into an https link. */
const BARE_DOMAIN = /^[^\s/@:]+\.[^\s/@:.]{2,}(?:[/?#]\S*)?$/;

/**
 * The editor's schema, cut to what the backend stores (see the spec in
 * `admin-richtext.ts`): StarterKit's paragraph, headings 2 and 3, bullet and
 * ordered lists, blockquote, code block, rule, hard break, and the bold,
 * italic, underline, strike, code and link marks, plus a block image. Nothing
 * else is registered, so a paste with a table or a colour loses it before it
 * reaches the document. Links carry `http(s):`, `mailto:` or a `/` path only.
 */
export function richTextExtensions(placeholder: string) {
  return [
    StarterKit.configure({
      heading: { levels: [2, 3] },
      // A fixed empty paragraph at the end would be stored with the document.
      trailingNode: false,
      link: {
        openOnClick: false,
        autolink: true,
        defaultProtocol: "https",
        protocols: ["http", "https", "mailto"],
        isAllowedUri: (url) => isAllowedLinkHref(url) || BARE_DOMAIN.test(url),
      },
    }),
    Image.configure({ inline: false, allowBase64: false }),
    Placeholder.configure({ placeholder }),
  ];
}
