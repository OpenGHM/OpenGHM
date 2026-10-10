"use client";

import { useId, useState } from "react";
import type { Editor } from "@tiptap/react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileUploadButton } from "@/components/admin/community/file-upload-button";
import { FieldError } from "@/components/admin/community/form-bits";
import { ImagePreview } from "@/components/admin/community/image-field";
import { isAllowedImageSrc, normalizeLinkInput } from "@/lib/community/admin-richtext";

/** The link dialog: set, change or remove the address of the selected text. */
export function LinkDialog({
  editor,
  open,
  onOpenChange,
}: {
  editor: Editor;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onCloseAutoFocus={() => !editor.isDestroyed && editor.commands.focus()}>
        {/* Mounted with the dialog, so each opening starts from the selection it was opened on. */}
        {open && <LinkForm editor={editor} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function LinkForm({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const id = useId();
  const existing = editor.isActive("link") ? String(editor.getAttributes("link").href ?? "") : "";
  // With nothing selected and no link under the cursor there is no text to link: ask for it.
  const needsText = !editor.isActive("link") && editor.state.selection.empty;
  const [href, setHref] = useState(existing);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const apply = (event: React.FormEvent) => {
    event.preventDefault();
    // The dialog is portalled, but React still bubbles its events to the editor's form.
    event.stopPropagation();
    const address = normalizeLinkInput(href);
    if (!address) {
      setError("Use an https:// address, an email address, or a path on this site that starts with /.");
      return;
    }
    if (needsText) {
      const label = text.trim() || address.replace(/^mailto:/, "");
      editor
        .chain()
        .focus()
        .insertContent({ type: "text", text: label, marks: [{ type: "link", attrs: { href: address } }] })
        .run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href: address }).run();
    }
    onClose();
  };

  const remove = () => {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    onClose();
  };

  return (
    <form onSubmit={apply} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{existing ? "Edit link" : "Add a link"}</DialogTitle>
        <DialogDescription>
          {needsText ? "Type the words readers will click, and where they lead." : "Where the selected text leads."}
        </DialogDescription>
      </DialogHeader>
      {needsText && (
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-text`} className="text-xs text-muted-foreground">
            Link text
          </Label>
          <Input id={`${id}-text`} value={text} autoComplete="off" onChange={(e) => setText(e.target.value)} />
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-href`} className="text-xs text-muted-foreground">
          Address
        </Label>
        <Input
          id={`${id}-href`}
          value={href}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          placeholder="https://example.org"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => {
            setHref(e.target.value);
            setError(null);
          }}
        />
        {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
      </div>
      <DialogFooter>
        {existing && (
          <Button type="button" variant="outline" className="min-h-10 sm:mr-auto sm:min-h-9" onClick={remove}>
            Remove link
          </Button>
        )}
        <Button type="button" variant="outline" className="min-h-10 sm:min-h-9" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" className="min-h-10 sm:min-h-9">
          {existing ? "Update link" : "Add link"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** The image dialog: an uploaded file or an https address, with the text a screen reader says and an optional caption. */
export function ImageDialog({
  editor,
  open,
  onOpenChange,
}: {
  editor: Editor;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onCloseAutoFocus={() => !editor.isDestroyed && editor.commands.focus()}>
        {open && <ImageForm editor={editor} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function ImageForm({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const id = useId();
  const editing = editor.isActive("image");
  const current = editing ? editor.getAttributes("image") : {};
  const [src, setSrc] = useState<string>(String(current.src ?? ""));
  const [alt, setAlt] = useState<string>(String(current.alt ?? ""));
  const [caption, setCaption] = useState<string>(String(current.title ?? ""));
  // The checks show after a first try, so an empty form is not all red.
  const [tried, setTried] = useState(false);

  const srcProblem = !src.trim()
    ? "Upload an image or paste its https:// address."
    : !isAllowedImageSrc(src.trim())
      ? "Use an https:// address, or upload the image."
      : null;
  const altProblem = alt.trim() ? null : "Describe the image for people who can't see it.";

  const apply = (event: React.FormEvent) => {
    event.preventDefault();
    // The dialog is portalled, but React still bubbles its events to the editor's form.
    event.stopPropagation();
    setTried(true);
    if (srcProblem || altProblem) return;
    const attrs = { src: src.trim(), alt: alt.trim(), title: caption.trim() };
    // The caption is the image's `title`; an empty one is dropped when the document is normalized.
    if (editing) editor.chain().focus().updateAttributes("image", attrs).run();
    else editor.chain().focus().setImage(attrs).run();
    onClose();
  };

  return (
    <form onSubmit={apply} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{editing ? "Edit image" : "Add an image"}</DialogTitle>
        <DialogDescription>
          The caption, if you write one, shows under the image on the site.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-2">
        <FileUploadButton
          kind="image"
          label="Upload an image"
          onUploaded={(file) => setSrc(file.url)}
        />
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-src`} className="text-xs text-muted-foreground">
            Or image address
          </Label>
          <Input
            id={`${id}-src`}
            value={src}
            autoComplete="off"
            spellCheck={false}
            placeholder="https://"
            aria-invalid={tried && srcProblem ? true : undefined}
            aria-describedby={tried && srcProblem ? `${id}-src-error` : undefined}
            onChange={(e) => setSrc(e.target.value)}
          />
          {tried && srcProblem && <FieldError id={`${id}-src-error`}>{srcProblem}</FieldError>}
        </div>
        {src.trim() && isAllowedImageSrc(src.trim()) && (
          <div className="rounded-xl bg-muted p-2">
            <ImagePreview src={src.trim()} className="mx-auto h-40 w-full object-contain" />
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${id}-alt`} className="text-xs text-muted-foreground">
          Description for screen readers
        </Label>
        <Input
          id={`${id}-alt`}
          value={alt}
          autoComplete="off"
          aria-invalid={tried && altProblem ? true : undefined}
          aria-describedby={tried && altProblem ? `${id}-alt-error` : undefined}
          onChange={(e) => setAlt(e.target.value)}
        />
        {tried && altProblem && <FieldError id={`${id}-alt-error`}>{altProblem}</FieldError>}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-caption`} className="text-xs text-muted-foreground">
          Caption <span className="font-normal">(optional)</span>
        </Label>
        <Input id={`${id}-caption`} value={caption} autoComplete="off" onChange={(e) => setCaption(e.target.value)} />
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" className="min-h-10 sm:min-h-9" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" className="min-h-10 sm:min-h-9">
          {editing ? "Update image" : "Add image"}
        </Button>
      </DialogFooter>
    </form>
  );
}
