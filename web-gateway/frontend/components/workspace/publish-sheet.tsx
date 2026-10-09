"use client";

import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Globe, Loader2, Plus, Trash2, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ActionError } from "@/components/workspace/action-error";
import { SessionExpiredBanner } from "@/components/workspace/session-expired-banner";
import { publishDraft } from "@/lib/jobs/actions";
import type { PartialAbout, PublishRecord } from "@/lib/jobs/types";
import { ABOUT_TAGS, humanizeTag, type AboutTag } from "@/lib/repository/catalogue";
import {
  LICENSE_SUGGESTIONS,
  aboutFromForm,
  firstInvalid,
  formFromAbout,
  isValid,
  newCreatorRow,
  SHORT_NAME_MAX,
  splitServerErrors,
  validatePublishForm,
  type PublishField,
  type PublishFormValues,
} from "@/lib/workspace/publish";

const TEXTAREA =
  "w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm";

/** A problem under its field. */
function FieldError({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className="text-xs text-destructive">
      {children}
    </p>
  );
}

/**
 * The form that publishes a snapshot draft as a snapshot (ADR 0031): the
 * `about` block a person writes, filled from the draft's own, in a sheet over
 * the right edge, so the page under it keeps its place. It says first that the
 * snapshot will be public and cannot be changed afterwards, because nothing
 * after the button can take it back.
 *
 * It stays open while the request is in flight, and when the backend refuses:
 * a 422 `invalid_about` puts its messages beside their fields, and everything
 * else (a 409, Anvil being down) is one sentence above the buttons, in the
 * backend's own words. A success hands the new publish record to the caller,
 * which follows it.
 */
export function PublishSheet({
  open,
  onOpenChange,
  jobId,
  about,
  baseName = null,
  preview = false,
  onPublished,
  onRefused,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  /** What the form starts from: the draft's `about`, or the one a failed
   *  publish was composed from, filled from the base snapshot's where it is
   *  missing (`prefillAbout`). */
  about: PartialAbout | null;
  /** The base snapshot's name, shown beside the Name field as where this one
   *  comes from; it is never filled in. Null when the base could not be read. */
  baseName?: string | null;
  /** Fixture data: there is no real job behind `jobId`, and nothing is sent. */
  preview?: boolean;
  /** The backend took it; `publish` is the record now `publishing`. */
  onPublished: (publish: PublishRecord) => void;
  /** The backend refused with a 409 (the draft cannot be published as the page
   *  believed) or a 5xx (it may have claimed the draft before the submit
   *  failed, and then the record says so). The caller should look again. */
  onRefused?: () => void;
  /** Where focus goes when the sheet closes. */
  onCloseAutoFocus?: (event: Event) => void;
}) {
  // Closing while the request is in flight would hide the only sign that
  // something is happening, and its answer.
  const [busy, setBusy] = useState(false);
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <SheetContent onCloseAutoFocus={onCloseAutoFocus} className="sm:max-w-xl">
        <PublishForm
          jobId={jobId}
          onBusyChange={setBusy}
          about={about}
          baseName={baseName}
          preview={preview}
          onClose={() => onOpenChange(false)}
          onPublished={onPublished}
          onRefused={onRefused}
        />
      </SheetContent>
    </Sheet>
  );
}

/** Mounted with the sheet's content, so each opening starts from `about`. */
function PublishForm({
  jobId,
  about,
  baseName,
  preview,
  onBusyChange,
  onClose,
  onPublished,
  onRefused,
}: {
  jobId: string;
  onBusyChange: (busy: boolean) => void;
  about: PartialAbout | null;
  baseName: string | null;
  preview: boolean;
  onClose: () => void;
  onPublished: (publish: PublishRecord) => void;
  onRefused?: () => void;
}) {
  const id = useId();
  const [values, setValues] = useState<PublishFormValues>(() => formFromAbout(about));
  // The checks show only after a first try, so an empty form is not all red.
  const [tried, setTried] = useState(false);
  const [pending, setPending] = useState(false);
  const [expired, setExpired] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [server, setServer] = useState<Partial<Record<PublishField, string>>>({});
  const bodyRef = useRef<HTMLDivElement>(null);

  const errors = validatePublishForm(values);
  const shown = (field: PublishField) => (tried ? errors.fields[field] : undefined) ?? server[field];
  const set = (patch: Partial<PublishFormValues>) => {
    setValues((v) => ({ ...v, ...patch }));
    // What the person is changing is no longer what the backend refused.
    setServer({});
  };

  const focusField = (field: PublishField) => {
    bodyRef.current?.querySelector<HTMLElement>(`[data-publish-field="${field}"]`)?.focus();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setTried(true);
    setFailure(null);
    setExpired(false);
    if (!isValid(errors)) {
      const first = firstInvalid(errors);
      if (first) queueMicrotask(() => focusField(first));
      return;
    }
    if (preview) {
      onClose();
      toast.info("Preview data — there is no real snapshot draft to publish.");
      return;
    }

    setPending(true);
    onBusyChange(true);
    try {
      const result = await publishDraft(jobId, aboutFromForm(values, about));
      if (result.ok) {
        onClose();
        onPublished(result.data.publish);
        toast.success("Publishing started. This takes a few minutes.");
      } else if (result.reason === "session_expired") {
        setExpired(true);
      } else if (result.reason === "not_found") {
        setFailure("This snapshot draft no longer exists.");
      } else if (result.code === "invalid_about" || result.status === 422) {
        const split = splitServerErrors(
          result.errors ??
            // A body the framework refused names only paths.
            result.fields?.map((path) => ({ path, message: result.message }))
        );
        setServer(split.fields);
        setFailure(
          split.general.length > 0
            ? split.general.join(" ")
            : Object.keys(split.fields).length > 0
              ? "The gateway refused some of these. Nothing was published; fix the fields marked below."
              : result.message
        );
        const first = (Object.keys(split.fields) as PublishField[])[0];
        if (first) queueMicrotask(() => focusField(first));
      } else {
        setFailure(result.message || "Could not start the publish.");
        if (result.status === 409 || (result.status ?? 0) >= 500) onRefused?.();
      }
    } catch {
      setFailure("Could not start the publish. Nothing was changed; try again.");
    } finally {
      setPending(false);
      onBusyChange(false);
    }
  };

  const toggleTag = (tag: AboutTag) =>
    set({ tags: values.tags.includes(tag) ? values.tags.filter((t) => t !== tag) : [...values.tags, tag] });
  const setCreator = (index: number, patch: Partial<PublishFormValues["creators"][number]>) =>
    set({ creators: values.creators.map((c, i) => (i === index ? { ...c, ...patch } : c)) });

  const describedBy = (field: PublishField) => (shown(field) ? `${id}-${field}-error` : undefined);
  const nameDescribedBy = [baseName ? `${id}-name-base` : null, describedBy("name") ?? null]
    .filter(Boolean)
    .join(" ") || undefined;
  const creatorProblem = shown("creator");

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="flex min-h-0 flex-1 flex-col">
      <SheetHeader>
        <SheetTitle className="text-base leading-snug">Publish as snapshot</SheetTitle>
        <SheetDescription className="leading-relaxed">
          Describe the snapshot the way it should read in the Data Repository. The gateway adds the date, its
          address, and the snapshot it was made from.
        </SheetDescription>
      </SheetHeader>

      <SheetBody ref={bodyRef} className="space-y-5">
        <div
          role="note"
          className="flex items-start gap-2.5 rounded-lg border border-warning/25 bg-warning/5 p-3 text-sm text-warning"
        >
          <Globe className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p className="min-w-0">
            <span className="font-semibold">This snapshot will be public, and it cannot be changed after it is
            published.</span>{" "}
            Anyone can read and download it. Check everything below before you publish.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${id}-name`} className="text-xs text-muted-foreground">
            Name
          </Label>
          <Input
            id={`${id}-name`}
            data-publish-field="name"
            value={values.name}
            autoComplete="off"
            className="h-10 md:h-9"
            placeholder="e.g. Global 2000–2009 baseline"
            aria-invalid={shown("name") ? true : undefined}
            aria-describedby={nameDescribedBy}
            onChange={(e) => set({ name: e.target.value })}
          />
          {baseName && (
            <p id={`${id}-name-base`} className="break-words text-xs text-muted-foreground">
              Based on: {baseName}
            </p>
          )}
          {shown("name") && <FieldError id={`${id}-name-error`}>{shown("name")}</FieldError>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${id}-shortName`} className="text-xs text-muted-foreground">
            Short name <span className="font-normal">(optional)</span>
          </Label>
          <Input
            id={`${id}-shortName`}
            data-publish-field="shortName"
            value={values.shortName}
            autoComplete="off"
            className="h-10 md:h-9"
            placeholder="e.g. WBM v1 Global 2000–2009"
            aria-invalid={shown("shortName") ? true : undefined}
            aria-describedby={[`${id}-shortName-hint`, describedBy("shortName")].filter(Boolean).join(" ")}
            onChange={(e) => set({ shortName: e.target.value })}
          />
          <p id={`${id}-shortName-hint`} className="flex justify-between gap-3 text-xs text-muted-foreground">
            <span>
              Shown in lists, cards and headers, where the full name is too long. The name above stays the
              title to cite.
            </span>
            <span className="shrink-0 tabular-nums">
              {[...values.shortName.trim()].length}/{SHORT_NAME_MAX}
            </span>
          </p>
          {shown("shortName") && <FieldError id={`${id}-shortName-error`}>{shown("shortName")}</FieldError>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${id}-description`} className="text-xs text-muted-foreground">
            Description
          </Label>
          <textarea
            id={`${id}-description`}
            data-publish-field="description"
            value={values.description}
            rows={4}
            placeholder="What does this snapshot hold, and how was it made?"
            aria-invalid={shown("description") ? true : undefined}
            aria-describedby={describedBy("description")}
            onChange={(e) => set({ description: e.target.value })}
            className={TEXTAREA}
          />
          {shown("description") && (
            <FieldError id={`${id}-description-error`}>{shown("description")}</FieldError>
          )}
        </div>

        <fieldset className="space-y-2" aria-describedby={creatorProblem ? `${id}-creator-error` : undefined}>
          <legend className="text-xs font-medium text-muted-foreground">Creators</legend>
          <ul className="space-y-3">
            {values.creators.map((creator, index) => {
              const row = tried ? errors.creators[index] : undefined;
              return (
                <li key={index} className="space-y-2 rounded-lg border bg-card p-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <Label htmlFor={`${id}-creator-${index}-name`} className="text-xs text-muted-foreground">
                        Creator name
                      </Label>
                      <Input
                        id={`${id}-creator-${index}-name`}
                        data-publish-field={index === 0 ? "creator" : undefined}
                        aria-label={`Creator ${index + 1} name`}
                        value={creator.name}
                        autoComplete="off"
                        className="h-10 md:h-9"
                        aria-invalid={row?.name ? true : undefined}
                        onChange={(e) => setCreator(index, { name: e.target.value })}
                      />
                      {row?.name && <FieldError id={`${id}-creator-${index}-name-error`}>{row.name}</FieldError>}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="mt-5 size-10 shrink-0 text-muted-foreground md:size-9"
                      disabled={values.creators.length === 1}
                      aria-label={`Remove creator ${index + 1}`}
                      onClick={() => set({ creators: values.creators.filter((_, i) => i !== index) })}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor={`${id}-creator-${index}-email`} className="text-xs text-muted-foreground">
                        Email <span className="font-normal">(optional)</span>
                      </Label>
                      <Input
                        id={`${id}-creator-${index}-email`}
                        type="email"
                        aria-label={`Creator ${index + 1} email`}
                        value={creator.email}
                        autoComplete="off"
                        className="h-10 md:h-9"
                        aria-invalid={row?.email ? true : undefined}
                        onChange={(e) => setCreator(index, { email: e.target.value })}
                      />
                      {row?.email && <FieldError id={`${id}-creator-${index}-email-error`}>{row.email}</FieldError>}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`${id}-creator-${index}-orcid`} className="text-xs text-muted-foreground">
                        ORCID <span className="font-normal">(optional)</span>
                      </Label>
                      <Input
                        id={`${id}-creator-${index}-orcid`}
                        aria-label={`Creator ${index + 1} ORCID`}
                        value={creator.orcid}
                        autoComplete="off"
                        placeholder="0000-0002-1825-0097"
                        className="h-10 font-mono md:h-9"
                        aria-invalid={row?.orcid ? true : undefined}
                        onChange={(e) => setCreator(index, { orcid: e.target.value })}
                      />
                      {row?.orcid && <FieldError id={`${id}-creator-${index}-orcid-error`}>{row.orcid}</FieldError>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          {creatorProblem && <FieldError id={`${id}-creator-error`}>{creatorProblem}</FieldError>}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-10 gap-1.5 sm:min-h-8"
            onClick={() => set({ creators: [...values.creators, newCreatorRow()] })}
          >
            <Plus aria-hidden="true" />
            Add creator
          </Button>
        </fieldset>

        <div className="space-y-1.5">
          <Label htmlFor={`${id}-license`} className="text-xs text-muted-foreground">
            License <span className="font-normal">(an SPDX identifier)</span>
          </Label>
          <Input
            id={`${id}-license`}
            data-publish-field="license"
            list={`${id}-licenses`}
            value={values.license}
            autoComplete="off"
            spellCheck={false}
            className="h-10 font-mono md:h-9"
            placeholder="e.g. CC-BY-4.0"
            aria-invalid={shown("license") ? true : undefined}
            aria-describedby={describedBy("license")}
            onChange={(e) => set({ license: e.target.value })}
          />
          <datalist id={`${id}-licenses`}>
            {LICENSE_SUGGESTIONS.map((license) => (
              <option key={license} value={license} />
            ))}
          </datalist>
          {shown("license") && <FieldError id={`${id}-license-error`}>{shown("license")}</FieldError>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${id}-keywords`} className="text-xs text-muted-foreground">
            Keywords <span className="font-normal">(separate with commas)</span>
          </Label>
          <Input
            id={`${id}-keywords`}
            data-publish-field="keywords"
            value={values.keywords}
            autoComplete="off"
            className="h-10 md:h-9"
            placeholder="e.g. discharge, global, 2001"
            aria-invalid={shown("keywords") ? true : undefined}
            aria-describedby={describedBy("keywords")}
            onChange={(e) => set({ keywords: e.target.value })}
          />
          {shown("keywords") && <FieldError id={`${id}-keywords-error`}>{shown("keywords")}</FieldError>}
        </div>

        <fieldset className="space-y-1.5" aria-describedby={describedBy("tags")}>
          <legend className="text-xs font-medium text-muted-foreground">Tags</legend>
          <div className="grid gap-x-4 sm:grid-cols-2">
            {ABOUT_TAGS.map((tag) => (
              <label
                key={tag}
                className="flex min-h-10 cursor-pointer items-center gap-2.5 text-sm text-foreground sm:min-h-8"
              >
                <input
                  type="checkbox"
                  data-publish-field={tag === ABOUT_TAGS[0] ? "tags" : undefined}
                  checked={values.tags.includes(tag)}
                  onChange={() => toggleTag(tag)}
                  className="size-4 shrink-0 rounded border-border accent-primary outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
                {humanizeTag(tag)}
              </label>
            ))}
          </div>
          {shown("tags") && <FieldError id={`${id}-tags-error`}>{shown("tags")}</FieldError>}
        </fieldset>
      </SheetBody>

      <SheetFooter className="flex-col items-stretch gap-3">
        {expired && <SessionExpiredBanner />}
        {failure && <ActionError>{failure}</ActionError>}
        <div className="flex items-center justify-end gap-3">
          <Button type="button" variant="outline" className="min-h-10 sm:min-h-9" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" className="min-h-10 gap-2 font-semibold sm:min-h-9" disabled={pending}>
            {pending ? (
              <>
                <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />
                Publishing…
              </>
            ) : (
              <>
                <UploadCloud aria-hidden="true" />
                Publish snapshot
              </>
            )}
          </Button>
        </div>
      </SheetFooter>
    </form>
  );
}
