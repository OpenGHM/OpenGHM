"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { TableHead, TableRow } from "@/components/ui/table";
import { ConfirmActionDialog } from "@/components/admin/confirm-action-dialog";
import { EmptyState } from "@/components/admin/admin-states";
import { StackedBody, StackedCell, StackedHeader, StackedRow, StackedTable } from "@/components/admin/stacked-table";
import { SaveNotices, StateSelect } from "@/components/admin/community/editor-chrome";
import { Field, SELECT_CLASS, StatePill, TEXTAREA_CLASS } from "@/components/admin/community/form-bits";
import { useContentEditor } from "@/components/admin/community/use-content-editor";
import { TimeStamp } from "@/components/common/time-stamp";
import { createPublication, deletePublication, updatePublication } from "@/lib/community/admin-actions";
import { citationPreview } from "@/lib/community/admin-format";
import {
  emptyPublicationForm,
  PUBLICATION_TYPES,
  publicationToForm,
  publicationToInput,
  validatePublication,
  type PublicationForm,
} from "@/lib/community/admin-forms";
import type { Publication, PublicationType } from "@/lib/community/types";

const typeLabel = (type: PublicationType) => PUBLICATION_TYPES.find((t) => t.value === type)?.label ?? type;

/** What the sheet is open on: a stored publication, a new one, or nothing. */
type Editing = { kind: "none" } | { kind: "new" } | { kind: "edit"; publication: Publication };

/**
 * The publications list, with the editor in a sheet over the right edge so the
 * list keeps its place. Year first, as the site orders them. A sheet with
 * unsaved changes asks before it closes. `startNew` opens it on a new
 * publication: the page's New publication link is `?new=1`, in the band like
 * every other section's New button, and the page keys this component on it.
 */
export function PublicationManager({ publications, startNew = false }: { publications: Publication[]; startNew?: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Editing>(startNew ? { kind: "new" } : { kind: "none" });
  const [discarding, setDiscarding] = useState(false);
  // The sheet's form reports whether it has unsaved input, so closing can ask.
  const dirty = useRef(false);

  const markDirty = useCallback((value: boolean) => {
    dirty.current = value;
  }, []);
  const close = () => {
    dirty.current = false;
    setEditing({ kind: "none" });
    // Drop `?new=1`, so the link opens a new sheet again next time.
    if (startNew) router.replace("/admin/community/publications", { scroll: false });
  };
  const requestClose = () => {
    if (dirty.current) setDiscarding(true);
    else close();
  };

  return (
    <>
      {publications.length === 0 ? (
        <EmptyState title="No publications yet.">
          Add the first one with New publication above. It stays a draft, off the site, until you publish it.
        </EmptyState>
      ) : (
        <StackedTable>
          <StackedHeader>
            <TableRow>
              <TableHead className="w-20">Year</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Updated</TableHead>
            </TableRow>
          </StackedHeader>
          <StackedBody>
            {publications.map((p) => (
              <StackedRow key={p.id}>
                <StackedCell label="Year" className="font-mono text-sm">
                  {p.year}
                </StackedCell>
                <StackedCell className="min-w-0">
                  <button
                    type="button"
                    onClick={() => setEditing({ kind: "edit", publication: p })}
                    className="min-h-10 text-left font-medium text-foreground underline-offset-4 outline-none hover:text-primary hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:min-h-0"
                  >
                    {p.title}
                  </button>
                  <p className="text-xs text-muted-foreground">{[p.authors, p.venue].filter(Boolean).join(" · ")}</p>
                </StackedCell>
                <StackedCell label="Type" className="text-sm">
                  {typeLabel(p.type)}
                </StackedCell>
                <StackedCell label="State">
                  <StatePill state={p.state} />
                </StackedCell>
                <StackedCell label="Updated" className="text-xs text-muted-foreground">
                  <TimeStamp value={p.updated_at} format="relative" />
                </StackedCell>
              </StackedRow>
            ))}
          </StackedBody>
        </StackedTable>
      )}

      <Sheet open={editing.kind !== "none"} onOpenChange={(open) => !open && requestClose()}>
        <SheetContent className="sm:max-w-xl">
          {editing.kind !== "none" && (
            <PublicationForm
              // A different publication is a different form.
              key={editing.kind === "edit" ? editing.publication.id : "new"}
              publication={editing.kind === "edit" ? editing.publication : null}
              onDirtyChange={markDirty}
              onClose={close}
              onCancel={requestClose}
            />
          )}
        </SheetContent>
      </Sheet>

      <ConfirmActionDialog
        open={discarding}
        onOpenChange={setDiscarding}
        title="Discard your changes?"
        description="What you typed in this publication is not saved and will be lost."
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        successMessage="Changes discarded."
        failureMessage="Couldn't close the editor."
        onConfirm={async () => ({ ok: true })}
        onDone={close}
      />
    </>
  );
}

function PublicationForm({
  publication,
  onDirtyChange,
  onClose,
  onCancel,
}: {
  publication: Publication | null;
  onDirtyChange: (dirty: boolean) => void;
  onClose: () => void;
  /** Closes the sheet, asking first when there is unsaved input. */
  onCancel: () => void;
}) {
  const router = useRouter();
  const uid = useId();
  const [initial] = useState(() => (publication ? publicationToForm(publication) : emptyPublicationForm()));
  const [deleting, setDeleting] = useState(false);

  const { form, setForm, errors, general, expired, saving, dirty, save, root } = useContentEditor<
    PublicationForm,
    ReturnType<typeof publicationToInput>,
    Publication
  >({
    initial,
    toInput: publicationToInput,
    validate: validatePublication,
    submit: (input) => (publication ? updatePublication(publication.id, input) : createPublication(input)),
    savedMessage: "Publication saved.",
    onSaved: () => {
      onClose();
      router.refresh();
    },
  });

  // Tell the list whether closing would lose anything.
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const id = (name: string) => `${uid}-${name}`;
  const set = (patch: Partial<PublicationForm>) => setForm(patch);

  return (
    <form
      ref={root}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <SheetHeader>
        <SheetTitle className="text-base leading-snug">{publication ? "Edit publication" : "New publication"}</SheetTitle>
        <SheetDescription className="leading-relaxed">
          A paper, dataset, software or talk listed on the Community page, newest year first.
        </SheetDescription>
      </SheetHeader>

      <SheetBody className="space-y-5">
        <SaveNotices expired={expired} general={general} />
        <div className="grid gap-4 sm:grid-cols-[7rem_1fr]">
          <Field id={id("year")} label="Year" error={errors.year}>
            {(p) => <Input {...p} inputMode="numeric" value={form.year} autoComplete="off" className="font-mono" onChange={(e) => set({ year: e.target.value })} />}
          </Field>
          <Field id={id("type")} label="Type" error={errors.type}>
            {(p) => (
              <select {...p} value={form.type} className={SELECT_CLASS} onChange={(e) => set({ type: e.target.value as PublicationType })}>
                {PUBLICATION_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <Field id={id("title")} label="Title" error={errors.title}>
          {(p) => <Input {...p} value={form.title} autoComplete="off" onChange={(e) => set({ title: e.target.value })} />}
        </Field>
        <Field id={id("authors")} label="Authors" error={errors.authors} hint="As they should read, for example “Kim, I., Smith, J.”.">
          {(p) => <textarea {...p} value={form.authors} rows={2} className={TEXTAREA_CLASS} onChange={(e) => set({ authors: e.target.value })} />}
        </Field>
        <Field id={id("venue")} label="Venue" error={errors.venue} hint="The journal, repository or event.">
          {(p) => <Input {...p} value={form.venue} autoComplete="off" onChange={(e) => set({ venue: e.target.value })} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-[9rem_1fr]">
          <Field id={id("link-label")} label="Link text" optional error={errors.link_label}>
            {(p) => <Input {...p} value={form.linkLabel} autoComplete="off" placeholder="DOI" onChange={(e) => set({ linkLabel: e.target.value })} />}
          </Field>
          <Field id={id("link-url")} label="Link address" optional error={errors.link_url}>
            {(p) => (
              <Input
                {...p}
                value={form.linkUrl}
                autoComplete="off"
                spellCheck={false}
                placeholder="https://"
                onChange={(e) => set({ linkUrl: e.target.value })}
              />
            )}
          </Field>
        </div>
        <Field
          id={id("citation")}
          label="Citation"
          optional
          hint="Write one to replace the generated citation below."
          error={errors.citation}
        >
          {(p) => <textarea {...p} value={form.citation} rows={3} className={TEXTAREA_CLASS} onChange={(e) => set({ citation: e.target.value })} />}
        </Field>
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Citation on the site</p>
          <p
            aria-live="polite"
            className="rounded-xl bg-hero px-4 py-3 font-mono text-[12.5px] leading-6 text-hero-text [overflow-wrap:anywhere]"
          >
            {citationPreview(form)}
          </p>
        </div>
      </SheetBody>

      <SheetFooter className="flex-wrap">
        <div className="flex items-center gap-2">
          <label htmlFor={id("state")} className="sr-only">
            State
          </label>
          <StateSelect id={id("state")} value={form.state} onChange={(state) => set({ state })} />
        </div>
        <div className="ml-auto flex items-center gap-2">
          {publication && (
            <Button
              type="button"
              variant="outline"
              className="min-h-10 text-destructive hover:text-destructive sm:min-h-9"
              onClick={() => setDeleting(true)}
            >
              <Trash2 aria-hidden="true" />
              Delete
            </Button>
          )}
          <Button type="button" variant="ghost" className="min-h-10 sm:min-h-9" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving} className="min-h-10 sm:min-h-9">
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </SheetFooter>

      {publication && (
        <ConfirmActionDialog
          open={deleting}
          onOpenChange={setDeleting}
          title="Delete this publication?"
          description="It is removed from the Community page."
          detail={publication.title}
          confirmLabel="Delete publication"
          pendingLabel="Deleting…"
          successMessage="Publication deleted."
          failureMessage="Couldn't delete the publication. Try again. If it keeps failing, the service may be unavailable."
          onConfirm={async () => {
            const result = await deletePublication(publication.id);
            if (result.ok) return { ok: true };
            if (result.reason === "session_expired") return { ok: false, message: "Your session has expired. Sign in again." };
            if (result.reason === "not_found") return { ok: true };
            return { ok: false, message: result.message };
          }}
          onDone={() => {
            // The sheet is closing for a publication that is gone, not for unsaved input.
            onDirtyChange(false);
            onClose();
            router.refresh();
          }}
        />
      )}
    </form>
  );
}
