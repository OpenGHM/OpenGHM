"use client";

import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import {
  Bold,
  Code,
  Code2,
  Heading2,
  Heading3,
  ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  Strikethrough,
  Underline as UnderlineIcon,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ImageDialog, LinkDialog } from "@/components/admin/community/rich-text-dialogs";
import { richTextExtensions } from "@/components/admin/community/rich-text-extensions";
import { normalizeDoc } from "@/lib/community/admin-richtext";
import { cn } from "@/lib/utils";
import type { RichTextDoc } from "@/lib/community/types";

interface ToolbarItem {
  key: string;
  label: string;
  icon: LucideIcon;
  active: (editor: Editor) => boolean;
  /** Whether it would do anything now; absent means always. */
  can?: (editor: Editor) => boolean;
  run: (editor: Editor) => void;
}

/** Marks, blocks and history, in the order the toolbar lists them; the link and image buttons open dialogs and are added in the component. */
const ITEMS: ToolbarItem[] = [
  { key: "bold", label: "Bold", icon: Bold, active: (e) => e.isActive("bold"), run: (e) => void e.chain().focus().toggleBold().run() },
  { key: "italic", label: "Italic", icon: Italic, active: (e) => e.isActive("italic"), run: (e) => void e.chain().focus().toggleItalic().run() },
  { key: "underline", label: "Underline", icon: UnderlineIcon, active: (e) => e.isActive("underline"), run: (e) => void e.chain().focus().toggleUnderline().run() },
  { key: "strike", label: "Strikethrough", icon: Strikethrough, active: (e) => e.isActive("strike"), run: (e) => void e.chain().focus().toggleStrike().run() },
  { key: "code", label: "Inline code", icon: Code, active: (e) => e.isActive("code"), run: (e) => void e.chain().focus().toggleCode().run() },
  { key: "h2", label: "Heading", icon: Heading2, active: (e) => e.isActive("heading", { level: 2 }), run: (e) => void e.chain().focus().toggleHeading({ level: 2 }).run() },
  { key: "h3", label: "Subheading", icon: Heading3, active: (e) => e.isActive("heading", { level: 3 }), run: (e) => void e.chain().focus().toggleHeading({ level: 3 }).run() },
  { key: "bulletList", label: "Bulleted list", icon: List, active: (e) => e.isActive("bulletList"), run: (e) => void e.chain().focus().toggleBulletList().run() },
  { key: "orderedList", label: "Numbered list", icon: ListOrdered, active: (e) => e.isActive("orderedList"), run: (e) => void e.chain().focus().toggleOrderedList().run() },
  { key: "blockquote", label: "Callout", icon: Quote, active: (e) => e.isActive("blockquote"), run: (e) => void e.chain().focus().toggleBlockquote().run() },
  { key: "codeBlock", label: "Code block", icon: Code2, active: (e) => e.isActive("codeBlock"), run: (e) => void e.chain().focus().toggleCodeBlock().run() },
  { key: "horizontalRule", label: "Divider", icon: Minus, active: () => false, run: (e) => void e.chain().focus().setHorizontalRule().run() },
];

const HISTORY: ToolbarItem[] = [
  { key: "undo", label: "Undo", icon: Undo2, active: () => false, can: (e) => e.can().undo(), run: (e) => void e.chain().focus().undo().run() },
  { key: "redo", label: "Redo", icon: Redo2, active: () => false, can: (e) => e.can().redo(), run: (e) => void e.chain().focus().redo().run() },
];

/** Where the toolbar's groups break, by the key that ends a group. */
const GROUP_ENDS = new Set(["code", "h3", "orderedList", "horizontalRule", "image"]);

/**
 * The article's own type, as the public page sets it: the first paragraph is
 * the larger lead, lists use "—" and "01" markers, a quote is a callout, an
 * image sits in its own block. A paragraph that is only a link is a large link
 * card on the site; the editor shows it as a link.
 */
const CONTENT_CLASS = cn(
  "min-h-72 px-4 py-4 text-[15px] leading-7 text-foreground/85 outline-none sm:px-6",
  "[&>p]:my-3 [&>p:first-child]:mt-0 [&>p:first-child]:text-lg [&>p:first-child]:leading-8 [&>p:first-child]:font-medium [&>p:first-child]:text-foreground",
  "[&_h2]:mt-7 [&_h2]:mb-2 [&_h2]:text-[22px] [&_h2]:leading-tight [&_h2]:font-semibold [&_h2]:tracking-[-0.01em] [&_h2]:text-foreground",
  "[&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-[18px] [&_h3]:leading-snug [&_h3]:font-semibold [&_h3]:text-foreground",
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2",
  "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.9em]",
  "[&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-hero [&_pre]:p-4 [&_pre]:font-mono [&_pre]:text-[13px] [&_pre]:leading-6 [&_pre]:text-hero-text [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-inherit",
  "[&_blockquote]:my-4 [&_blockquote]:rounded-r-xl [&_blockquote]:border-l-4 [&_blockquote]:border-primary [&_blockquote]:bg-secondary [&_blockquote]:px-4 [&_blockquote]:py-3 [&_blockquote_p]:my-1",
  "[&_hr]:my-6 [&_hr]:border-border",
  "[&_ul]:my-3 [&_ul]:list-none [&_ul]:p-0 [&_ol]:my-3 [&_ol]:list-none [&_ol]:p-0 [&_ol]:[counter-reset:item]",
  "[&_li]:relative [&_li]:py-1 [&_li]:pl-9 [&_li>p]:my-0",
  "[&_ul>li]:before:absolute [&_ul>li]:before:left-0 [&_ul>li]:before:text-muted-foreground [&_ul>li]:before:content-['—']",
  "[&_ol>li]:[counter-increment:item] [&_ol>li]:before:absolute [&_ol>li]:before:left-0 [&_ol>li]:before:font-mono [&_ol>li]:before:text-[13px] [&_ol>li]:before:text-muted-foreground [&_ol>li]:before:content-[counter(item,decimal-leading-zero)]",
  "[&_img]:my-4 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-xl [&_img.ProseMirror-selectednode]:outline-2 [&_img.ProseMirror-selectednode]:outline-offset-2 [&_img.ProseMirror-selectednode]:outline-ring",
  "[&_p.is-editor-empty:first-child::before]:pointer-events-none [&_p.is-editor-empty:first-child::before]:float-left [&_p.is-editor-empty:first-child::before]:h-0 [&_p.is-editor-empty:first-child::before]:text-muted-foreground [&_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]"
);

type Dialog = "link" | "image" | null;

/**
 * The rich-text editor of the Community admin (Tiptap). It writes exactly the
 * document the backend stores: headings 2 and 3, lists, a callout, a code
 * block, a divider, links and images, and the bold, italic, underline, strike
 * and code marks. The value goes in and out as a `RichTextDoc`; an empty
 * document is null. The editor starts from `value` and does not follow later
 * changes to it: remount it (change its `key`) to load another document.
 *
 * The toolbar is one tab stop (arrow keys, Home and End move along it), its
 * toggles carry `aria-pressed`, and every button has a name and a tooltip. The
 * content area is a labelled textbox; pass `ariaLabel` or `labelledBy`.
 */
export function RichTextEditor({
  value,
  onChange,
  id,
  ariaLabel,
  labelledBy,
  describedBy,
  invalid = false,
  placeholder = "Write the page…",
  disabled = false,
}: {
  value: RichTextDoc | null;
  onChange: (doc: RichTextDoc | null) => void;
  id?: string;
  ariaLabel?: string;
  labelledBy?: string;
  describedBy?: string;
  invalid?: boolean;
  placeholder?: string;
  disabled?: boolean;
}) {
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  const [dialog, setDialog] = useState<Dialog>(null);

  const editor = useEditor({
    // Server-rendered, then hydrated: the editor is made in the browser only.
    immediatelyRender: false,
    extensions: richTextExtensions(placeholder),
    content: value ?? undefined,
    editable: !disabled,
    editorProps: {
      attributes: {
        ...(id ? { id } : {}),
        role: "textbox",
        "aria-multiline": "true",
        ...(ariaLabel ? { "aria-label": ariaLabel } : {}),
        ...(labelledBy ? { "aria-labelledby": labelledBy } : {}),
        ...(describedBy ? { "aria-describedby": describedBy } : {}),
        ...(invalid ? { "aria-invalid": "true" } : {}),
        class: CONTENT_CLASS,
      },
    },
    onUpdate: ({ editor: e }) => onChangeRef.current(normalizeDoc(e.getJSON() as RichTextDoc)),
  });

  return (
    <div
      className={cn(
        "rounded-xl border bg-card transition-[box-shadow,border-color] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/30",
        invalid ? "border-destructive" : "border-input",
        disabled && "opacity-60"
      )}
    >
      {editor ? (
        <>
          <Toolbar editor={editor} disabled={disabled} onDialog={setDialog} />
          <EditorContent editor={editor} />
          <LinkDialog editor={editor} open={dialog === "link"} onOpenChange={(o) => setDialog(o ? "link" : null)} />
          <ImageDialog editor={editor} open={dialog === "image"} onOpenChange={(o) => setDialog(o ? "image" : null)} />
        </>
      ) : (
        // Before the editor exists (server render, first paint): the frame at its final height.
        <div className="min-h-72" aria-hidden="true" />
      )}
    </div>
  );
}

function Toolbar({
  editor,
  disabled,
  onDialog,
}: {
  editor: Editor;
  disabled: boolean;
  onDialog: (dialog: Dialog) => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const [rovingKey, setRovingKey] = useState("bold");

  const items: ToolbarItem[] = [
    ...ITEMS,
    { key: "link", label: "Link", icon: LinkIcon, active: (e) => e.isActive("link"), run: () => onDialog("link") },
    { key: "image", label: "Image", icon: ImageIcon, active: (e) => e.isActive("image"), run: () => onDialog("image") },
    ...HISTORY,
  ];

  // The toolbar re-renders on each transaction through this, not through the
  // editor: `useEditor` does not re-render the component on a selection change.
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      Object.fromEntries(
        items.map((item) => [item.key, { on: item.active(e), can: item.can ? item.can(e) : true }])
      ),
  });

  const onKeyDown = (event: React.KeyboardEvent) => {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key) || !bar.current) return;
    const buttons = Array.from(bar.current.querySelectorAll<HTMLButtonElement>("button"));
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    event.preventDefault();
    const next =
      event.key === "Home" ? 0
      : event.key === "End" ? buttons.length - 1
      : event.key === "ArrowRight" ? (at + 1) % buttons.length
      : (at - 1 + buttons.length) % buttons.length;
    buttons[next].focus();
  };

  return (
    <div
      ref={bar}
      role="toolbar"
      aria-label="Text formatting"
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      className="sticky top-14 z-10 flex flex-wrap items-center gap-y-1 rounded-t-xl lg:top-0 border-b bg-card px-1.5 py-1.5"
    >
      {items.map((item) => {
        const s = state?.[item.key];
        const Icon = item.icon;
        const isToggle = item.key !== "undo" && item.key !== "redo" && item.key !== "horizontalRule";
        const unavailable = disabled || s?.can === false;
        return (
          <span key={item.key} className="contents">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={item.label}
                  aria-pressed={isToggle ? Boolean(s?.on) : undefined}
                  aria-disabled={unavailable || undefined}
                  tabIndex={item.key === rovingKey ? 0 : -1}
                  onFocus={() => setRovingKey(item.key)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    if (!unavailable) item.run(editor);
                  }}
                  className={cn(
                    "inline-flex size-10 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:hover:bg-transparent sm:size-8",
                    s?.on && "bg-secondary text-primary hover:bg-secondary hover:text-primary"
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{item.label}</TooltipContent>
            </Tooltip>
            {GROUP_ENDS.has(item.key) && <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />}
          </span>
        );
      })}
    </div>
  );
}
