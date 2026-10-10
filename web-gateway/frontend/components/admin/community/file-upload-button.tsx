"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SessionExpiredBanner } from "@/components/workspace/session-expired-banner";
import { useFileUpload } from "@/components/admin/community/use-file-upload";
import { acceptFor, formatFileSize, MAX_UPLOAD_BYTES, type UploadKind } from "@/lib/community/admin-format";
import { cn } from "@/lib/utils";
import type { CommunityFile } from "@/lib/community/types";

/**
 * A button that opens the file picker and uploads what was chosen to the
 * Community media library. While a file is on its way the button says how far
 * it is; a refusal (wrong type, over 25 MiB, a failed request) stays under it
 * as an alert. With `multiple` the files go one after another and
 * `onUploaded` is called for each as it lands.
 */
export function FileUploadButton({
  kind,
  label,
  multiple = false,
  disabled = false,
  variant = "outline",
  className,
  onUploaded,
}: {
  kind: UploadKind;
  label: string;
  multiple?: boolean;
  disabled?: boolean;
  variant?: "outline" | "secondary" | "default";
  className?: string;
  onUploaded: (file: CommunityFile, source: File) => void;
}) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const { pending, progress, error, expired, upload, reset } = useFileUpload(kind);
  const [batch, setBatch] = useState<{ index: number; total: number } | null>(null);
  const [skipped, setSkipped] = useState<string | null>(null);
  // A batch outlives the render it started in; each file reaches the latest `onUploaded`,
  // which sees the list as the files before it left it.
  const landed = useRef(onUploaded);
  useEffect(() => {
    landed.current = onUploaded;
  });

  const choose = async (files: FileList | null) => {
    const list = files ? Array.from(files) : [];
    if (input.current) input.current.value = "";
    if (list.length === 0) return;
    setSkipped(null);
    reset();
    const failed: string[] = [];
    for (let i = 0; i < list.length; i++) {
      setBatch({ index: i + 1, total: list.length });
      const stored = await upload(list[i]);
      if (stored) landed.current(stored, list[i]);
      else {
        failed.push(list[i].name);
        // A failed file's reason is in `error`; the rest still go.
        if (list.length === 1) break;
      }
    }
    setBatch(null);
    if (list.length > 1 && failed.length > 0) {
      setSkipped(`${failed.length} of ${list.length} files were not uploaded: ${failed.join(", ")}.`);
    }
  };

  const percent = progress === null ? null : Math.round(progress * 100);

  return (
    <div className={cn("space-y-2", className)}>
      <input
        ref={input}
        id={inputId}
        type="file"
        hidden
        multiple={multiple}
        accept={acceptFor(kind)}
        data-testid="community-file-input"
        onChange={(e) => void choose(e.target.files)}
      />
      <Button
        type="button"
        variant={variant}
        size="sm"
        disabled={disabled || pending}
        aria-describedby={`${inputId}-hint`}
        onClick={() => input.current?.click()}
        className="min-h-10 sm:min-h-8"
      >
        {pending ? (
          <>
            <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />
            {batch && batch.total > 1 ? `Uploading ${batch.index} of ${batch.total}` : "Uploading"}
            {percent !== null && ` ${percent}%`}
          </>
        ) : (
          <>
            <Upload aria-hidden="true" />
            {label}
          </>
        )}
      </Button>
      <p id={`${inputId}-hint`} className="sr-only">
        Up to {formatFileSize(MAX_UPLOAD_BYTES)} each.
      </p>
      {/* The status is announced as it changes; the button's own text is not a live region. */}
      <p role="status" className="sr-only">
        {pending ? "Uploading." : ""}
      </p>
      {expired && <SessionExpiredBanner />}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {skipped && (
        <p role="alert" className="text-xs text-destructive">
          {skipped}
        </p>
      )}
    </div>
  );
}
