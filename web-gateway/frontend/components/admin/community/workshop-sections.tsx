"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FileUploadButton } from "@/components/admin/community/file-upload-button";
import { Field, ReorderButtons } from "@/components/admin/community/form-bits";
import { ImagePreview } from "@/components/admin/community/image-field";
import { moveItem, uploadNote } from "@/lib/community/admin-format";
import { LIMITS, newRowKey, type FormErrors, type WorkshopForm } from "@/lib/community/admin-forms";

/** The rows with `patch` applied to the one at `index`. */
function patchRow<T>(rows: T[], index: number, patch: Partial<T>): T[] {
  return rows.map((row, i) => (i === index ? { ...row, ...patch } : row));
}

const withoutRow = <T,>(rows: T[], index: number): T[] => rows.filter((_, i) => i !== index);

const EMPTY_LIST =
  "rounded-xl border border-dashed border-input px-4 py-5 text-center text-sm text-muted-foreground";

/** A remove button for one row of a list. */
function RemoveRowButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-10 text-muted-foreground md:size-8"
      aria-label={label}
      onClick={onClick}
    >
      <Trash2 aria-hidden="true" />
    </Button>
  );
}

/** The extra rows of the side panel ("Computing: NSF ACCESS resource Anvil"), in the order they are shown. */
export function DetailsEditor({
  id,
  rows,
  onChange,
  errors,
}: {
  id: string;
  rows: WorkshopForm["details"];
  onChange: (rows: WorkshopForm["details"]) => void;
  errors: FormErrors;
}) {
  return (
    <div className="space-y-3">
      {rows.length === 0 && (
        <p className={EMPTY_LIST}>
          No extra rows. When, Format and Location are already in the panel; add anything else that helps, such as
          &quot;Computing&quot;.
        </p>
      )}
      <ul className="space-y-3">
        {rows.map((row, i) => (
          <li key={row.key} className="flex items-start gap-2 rounded-xl border bg-card p-3">
            <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-[minmax(0,12rem)_1fr]">
              <Field id={`${id}-${row.key}-label`} label="Label" error={errors[`details.${i}.label`]}>
                {(p) => (
                  <Input
                    {...p}
                    value={row.label}
                    autoComplete="off"
                    placeholder="Computing"
                    onChange={(e) => onChange(patchRow(rows, i, { label: e.target.value }))}
                  />
                )}
              </Field>
              <Field id={`${id}-${row.key}-value`} label="Value" error={errors[`details.${i}.value`]}>
                {(p) => (
                  <Input
                    {...p}
                    value={row.value}
                    autoComplete="off"
                    placeholder="NSF ACCESS resource Anvil"
                    onChange={(e) => onChange(patchRow(rows, i, { value: e.target.value }))}
                  />
                )}
              </Field>
            </div>
            <div className="flex shrink-0 items-center pt-5">
              <ReorderButtons index={i} count={rows.length} noun="row" onMove={(from, to) => onChange(moveItem(rows, from, to))} />
              <RemoveRowButton label={`Remove row ${i + 1}`} onClick={() => onChange(withoutRow(rows, i))} />
            </div>
          </li>
        ))}
      </ul>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="min-h-10 sm:min-h-8"
        disabled={rows.length >= LIMITS.maxDetails}
        onClick={() => onChange([...rows, { key: newRowKey(), label: "", value: "" }])}
      >
        <Plus aria-hidden="true" />
        Add row
      </Button>
      {errors.details && <p className="text-xs text-destructive">{errors.details}</p>}
    </div>
  );
}

/** The photo grid: upload several at once, caption, reorder, remove. */
export function PhotosEditor({
  id,
  rows,
  onChange,
  errors,
}: {
  id: string;
  rows: WorkshopForm["photos"];
  onChange: (rows: WorkshopForm["photos"]) => void;
  errors: FormErrors;
}) {
  const [address, setAddress] = useState("");
  const full = rows.length >= LIMITS.maxPhotos;

  const add = (url: string) => onChange([...rows, { key: newRowKey(), url, caption: "" }]);
  const addAddress = () => {
    if (!address.trim() || full) return;
    add(address.trim());
    setAddress("");
  };

  return (
    <div className="space-y-4">
      {rows.length === 0 ? (
        <p className={EMPTY_LIST}>No photos yet. They show as a gallery on the workshop page, and open larger when clicked.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((row, i) => (
            <li key={row.key} className="space-y-2 rounded-xl border bg-card p-2.5">
              <ImagePreview src={row.url} className="aspect-[4/3] w-full" />
              <Field
                id={`${id}-${row.key}-caption`}
                label={`Caption for photo ${i + 1}`}
                optional
                error={errors[`photos.${i}.url`]}
              >
                {(p) => (
                  <Input
                    {...p}
                    value={row.caption}
                    autoComplete="off"
                    onChange={(e) => onChange(patchRow(rows, i, { caption: e.target.value }))}
                  />
                )}
              </Field>
              <div className="flex items-center justify-between">
                <ReorderButtons index={i} count={rows.length} noun="photo" onMove={(from, to) => onChange(moveItem(rows, from, to))} />
                <RemoveRowButton label={`Remove photo ${i + 1}`} onClick={() => onChange(withoutRow(rows, i))} />
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-start gap-3">
        <FileUploadButton kind="image" label="Upload photos" multiple disabled={full} onUploaded={(file) => add(file.url)} />
        <div className="flex min-w-0 flex-1 gap-2 sm:max-w-md">
          <Input
            value={address}
            autoComplete="off"
            spellCheck={false}
            placeholder="Or an image address, https://"
            aria-label="Photo address"
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => {
              // Enter adds the address here; it does not save the whole form.
              if (e.key === "Enter") {
                e.preventDefault();
                addAddress();
              }
            }}
            className="h-10 sm:h-8"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-10 sm:min-h-8"
            disabled={!address.trim() || full}
            onClick={addAddress}
          >
            Add
          </Button>
        </div>
      </div>
      {full && <p className="text-xs text-muted-foreground">A workshop holds at most {LIMITS.maxPhotos} photos.</p>}
      {errors.photos && <p className="text-xs text-destructive">{errors.photos}</p>}
    </div>
  );
}

/** Slides, recordings and other files: each a name and either an uploaded file or a link. */
export function MaterialsEditor({
  id,
  rows,
  onChange,
  errors,
}: {
  id: string;
  rows: WorkshopForm["materials"];
  onChange: (rows: WorkshopForm["materials"]) => void;
  errors: FormErrors;
}) {
  return (
    <div className="space-y-3">
      {rows.length === 0 && (
        <p className={EMPTY_LIST}>No materials yet. Add slides, a recording or a notebook, as an uploaded file or a link.</p>
      )}
      <ul className="space-y-3">
        {rows.map((row, i) => (
          <li key={row.key} className="space-y-3 rounded-xl border bg-card p-3">
            <div className="flex items-start gap-2">
              <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-[1fr_minmax(0,12rem)]">
                <Field id={`${id}-${row.key}-name`} label="Name" error={errors[`materials.${i}.name`]}>
                  {(p) => (
                    <Input
                      {...p}
                      value={row.name}
                      autoComplete="off"
                      placeholder="Slides"
                      onChange={(e) => onChange(patchRow(rows, i, { name: e.target.value }))}
                    />
                  )}
                </Field>
                <Field id={`${id}-${row.key}-note`} label="Note" optional error={errors[`materials.${i}.note`]}>
                  {(p) => (
                    <Input
                      {...p}
                      value={row.note}
                      autoComplete="off"
                      placeholder="PDF · 6.1 MB"
                      onChange={(e) => onChange(patchRow(rows, i, { note: e.target.value }))}
                    />
                  )}
                </Field>
              </div>
              <div className="flex shrink-0 items-center pt-5">
                <ReorderButtons index={i} count={rows.length} noun="material" onMove={(from, to) => onChange(moveItem(rows, from, to))} />
                <RemoveRowButton label={`Remove material ${i + 1}`} onClick={() => onChange(withoutRow(rows, i))} />
              </div>
            </div>
            <div className="flex flex-wrap items-start gap-3">
              <Field
                id={`${id}-${row.key}-url`}
                label="File or link address"
                error={errors[`materials.${i}.url`]}
                className="min-w-0 flex-1 basis-64"
              >
                {(p) => (
                  <Input
                    {...p}
                    value={row.url}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="https://"
                    onChange={(e) => onChange(patchRow(rows, i, { url: e.target.value }))}
                  />
                )}
              </Field>
              <FileUploadButton
                kind="file"
                label="Upload a file"
                className="pt-5"
                onUploaded={(file) =>
                  onChange(
                    patchRow(rows, i, {
                      url: file.url,
                      // A name already typed stays; a file just uploaded says what it is.
                      name: row.name.trim() ? row.name : file.filename.replace(/\.[^.]+$/, ""),
                      note: uploadNote(file.filename, file.size),
                    })
                  )
                }
              />
            </div>
          </li>
        ))}
      </ul>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="min-h-10 sm:min-h-8"
        disabled={rows.length >= LIMITS.maxMaterials}
        onClick={() => onChange([...rows, { key: newRowKey(), name: "", url: "", note: "" }])}
      >
        <Plus aria-hidden="true" />
        Add material
      </Button>
      {errors.materials && <p className="text-xs text-destructive">{errors.materials}</p>}
    </div>
  );
}
