"use client";

import { useState } from "react";
import { ImageOff, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FileUploadButton } from "@/components/admin/community/file-upload-button";
import { Field } from "@/components/admin/community/form-bits";
import { cn } from "@/lib/utils";

/** An image, or the reason it is not there. A failed address is a grey box, not a broken-image icon. */
export function ImagePreview({
  src,
  alt = "",
  className,
}: {
  src: string;
  alt?: string;
  className?: string;
}) {
  // Remembers which address failed, so a new address gets a new try.
  const [failed, setFailed] = useState<string | null>(null);
  if (!src || failed === src) {
    return (
      <div
        className={cn("grid place-items-center rounded-xl bg-muted text-muted-foreground", className)}
        role={src ? "img" : undefined}
        aria-label={src ? "This image could not be shown" : undefined}
      >
        <ImageOff className="size-5" aria-hidden="true" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- an admin's preview of any stored address, not a site image
    <img src={src} alt={alt} className={cn("rounded-xl object-cover", className)} onError={() => setFailed(src)} />
  );
}

export interface ImageValue {
  url: string;
  alt: string;
  caption: string;
}

/**
 * One image with what a page needs to show it: the picture (uploaded, or an
 * address), a description for screen readers and an optional caption. The
 * workshop's cover uses it. `error` is by field (`url`, `alt`, `caption`).
 */
export function ImageField({
  id,
  value,
  onChange,
  errors = {},
}: {
  id: string;
  value: ImageValue;
  onChange: (next: ImageValue) => void;
  errors?: { url?: string; alt?: string; caption?: string };
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-[minmax(0,14rem)_1fr]">
      <div className="space-y-2">
        <ImagePreview src={value.url} alt={value.alt} className="aspect-[4/3] w-full" />
        <div className="flex flex-wrap gap-2">
          <FileUploadButton
            kind="image"
            label={value.url ? "Replace image" : "Upload image"}
            onUploaded={(file) => onChange({ ...value, url: file.url })}
          />
          {value.url && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-10 text-muted-foreground sm:min-h-8"
              onClick={() => onChange({ url: "", alt: "", caption: "" })}
            >
              <Trash2 aria-hidden="true" />
              Remove
            </Button>
          )}
        </div>
      </div>
      <div className="min-w-0 space-y-4">
        <Field id={`${id}-url`} label="Image address" hint="Filled in when you upload. Or paste an https:// address." error={errors.url}>
          {(p) => (
            <Input
              {...p}
              value={value.url}
              autoComplete="off"
              spellCheck={false}
              placeholder="https://"
              onChange={(e) => onChange({ ...value, url: e.target.value })}
            />
          )}
        </Field>
        <Field id={`${id}-alt`} label="Description for screen readers" error={errors.alt}>
          {(p) => <Input {...p} value={value.alt} autoComplete="off" onChange={(e) => onChange({ ...value, alt: e.target.value })} />}
        </Field>
        <Field id={`${id}-caption`} label="Caption" optional error={errors.caption}>
          {(p) => <Input {...p} value={value.caption} autoComplete="off" onChange={(e) => onChange({ ...value, caption: e.target.value })} />}
        </Field>
      </div>
    </div>
  );
}
