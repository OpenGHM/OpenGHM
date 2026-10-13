"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Link2, Pencil, Terminal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmActionDialog } from "@/components/admin/confirm-action-dialog";
import { EditorSection, SaveBar, SaveNotices, ViewOnSiteButton } from "@/components/admin/community/editor-chrome";
import { Field, SELECT_CLASS, TEXTAREA_CLASS } from "@/components/admin/community/form-bits";
import { RichTextEditor } from "@/components/admin/community/rich-text-editor";
import { useContentEditor } from "@/components/admin/community/use-content-editor";
import { createTutorial, deleteTutorial, updateTutorial } from "@/lib/community/admin-actions";
import { defaultActionLabel, slugify } from "@/lib/community/admin-format";
import {
  emptyTutorialForm,
  LIMITS,
  TUTORIAL_KINDS,
  TUTORIAL_LEVELS,
  tutorialToForm,
  tutorialToInput,
  validateTutorial,
  type TutorialForm,
} from "@/lib/community/admin-forms";
import { isEmptyDoc } from "@/lib/community/admin-richtext";
import type { Tutorial, TutorialKind, TutorialLevel } from "@/lib/community/types";

/**
 * The tutorial editor, for a new tutorial (`tutorial` null) and a stored one.
 * A tutorial is a card on the Community page: a title and summary, its kind,
 * length and level, a short code snippet for the dark header, and where the
 * button leads. With page text it also gets its own page; without, the card
 * links to the address. Saves like the workshop editor: by the button or
 * Ctrl or Cmd + S, with a guard for unsaved changes.
 */
export function TutorialEditor({ tutorial }: { tutorial: Tutorial | null }) {
  const router = useRouter();
  const uid = useId();
  const [initial] = useState(() => (tutorial ? tutorialToForm(tutorial) : emptyTutorialForm()));
  const [stored, setStored] = useState<Tutorial | null>(tutorial);
  const [deleting, setDeleting] = useState(false);

  const { form, setForm, errors, general, expired, saving, dirty, save, root } = useContentEditor<
    TutorialForm,
    ReturnType<typeof tutorialToInput>,
    Tutorial
  >({
    initial,
    toInput: tutorialToInput,
    validate: validateTutorial,
    submit: (input) => (stored ? updateTutorial(stored.id, input) : createTutorial(input)),
    savedMessage: "Tutorial saved.",
    onSaved: (saved) => {
      const created = stored === null;
      setStored(saved);
      if (created) router.replace(`/admin/community/tutorials/${encodeURIComponent(saved.id)}`);
      else router.refresh();
    },
  });

  const id = (name: string) => `${uid}-${name}`;
  const set = (patch: Partial<TutorialForm>) => setForm(patch);
  const hasPage = stored !== null && !isEmptyDoc(stored.body);

  return (
    <form
      ref={root}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="space-y-6"
    >
      <SaveNotices expired={expired} general={general} />

      <EditorSection icon={Pencil} title="Tutorial" description="The card on the Community page.">
        <Field id={id("title")} label="Title" error={errors.title}>
          {(p) => (
            <Input
              {...p}
              value={form.title}
              autoComplete="off"
              placeholder="Your first snapshot draft"
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  title: e.target.value,
                  slug: f.slugTouched ? f.slug : slugify(e.target.value),
                }))
              }
            />
          )}
        </Field>
        <Field
          id={id("slug")}
          label="Slug"
          hint={`The tutorial's web address, when it has page text: /community/tutorials/${form.slug || "…"}`}
          error={errors.slug}
        >
          {(p) => (
            <Input
              {...p}
              value={form.slug}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
              onChange={(e) => setForm({ slug: e.target.value, slugTouched: e.target.value !== "" })}
            />
          )}
        </Field>
        <Field
          id={id("summary")}
          label="Summary"
          hint={`${form.summary.trim().length} of ${LIMITS.tutorialSummary} characters.`}
          error={errors.summary}
        >
          {(p) => (
            <textarea {...p} value={form.summary} rows={3} className={TEXTAREA_CLASS} onChange={(e) => set({ summary: e.target.value })} />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id={id("kind")} label="Kind" error={errors.kind}>
            {(p) => (
              <select {...p} value={form.kind} className={SELECT_CLASS} onChange={(e) => set({ kind: e.target.value as TutorialKind })}>
                {TUTORIAL_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field id={id("level")} label="Level" error={errors.level}>
            {(p) => (
              <select {...p} value={form.level} className={SELECT_CLASS} onChange={(e) => set({ level: e.target.value as TutorialLevel })}>
                {TUTORIAL_LEVELS.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field id={id("minutes")} label="Minutes" optional error={errors.minutes}>
            {(p) => (
              <Input
                {...p}
                inputMode="numeric"
                value={form.minutes}
                autoComplete="off"
                placeholder="20"
                onChange={(e) => set({ minutes: e.target.value })}
              />
            )}
          </Field>
        </div>
      </EditorSection>

      <EditorSection
        icon={Terminal}
        title="Code snippet"
        description="Plain text for the dark header of the card, such as a command or a line of code."
      >
        <Field
          id={id("snippet")}
          label="Snippet"
          optional
          hint={`${form.snippet.length} of ${LIMITS.tutorialSnippet} characters.`}
          error={errors.snippet}
        >
          {(p) => (
            <textarea
              {...p}
              value={form.snippet}
              rows={4}
              spellCheck={false}
              className={`${TEXTAREA_CLASS} font-mono`}
              onChange={(e) => set({ snippet: e.target.value })}
            />
          )}
        </Field>
      </EditorSection>

      <EditorSection
        icon={Link2}
        title="Button"
        description="Where the card leads. A tutorial with page text opens its own page and ignores the address."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id={id("action")}
            label="Button text"
            optional
            hint={`Left empty, the button says “${defaultActionLabel(form.kind)}”.`}
            error={errors.action_label}
          >
            {(p) => (
              <Input
                {...p}
                value={form.actionLabel}
                autoComplete="off"
                placeholder={defaultActionLabel(form.kind)}
                onChange={(e) => set({ actionLabel: e.target.value })}
              />
            )}
          </Field>
          <Field id={id("url")} label="Address" optional error={errors.url} hint="https:// or a path on this site, like /workspace.">
            {(p) => (
              <Input
                {...p}
                value={form.url}
                autoComplete="off"
                spellCheck={false}
                placeholder="https://"
                onChange={(e) => set({ url: e.target.value })}
              />
            )}
          </Field>
        </div>
      </EditorSection>

      <EditorSection icon={FileText} title="Page text" description="Optional. Write the tutorial here to give it a page of its own.">
        <div className="space-y-1.5">
          <span id={id("body-label")} className="sr-only">
            Page text
          </span>
          <RichTextEditor
            value={form.body}
            onChange={(body) => set({ body })}
            labelledBy={id("body-label")}
            describedBy={errors.body ? id("body-error") : undefined}
            invalid={Boolean(errors.body)}
            placeholder="Write the tutorial…"
          />
          {errors.body && (
            <p id={id("body-error")} className="text-xs text-destructive">
              {errors.body}
            </p>
          )}
        </div>
      </EditorSection>

      <SaveBar
        stateId={id("state")}
        state={form.state}
        onStateChange={(state) => set({ state })}
        dirty={dirty}
        saving={saving}
        saveLabel={stored ? "Save changes" : "Create tutorial"}
        cancelHref="/admin/community/tutorials"
        extra={
          <>
            {stored?.state === "published" && hasPage&& (
              <ViewOnSiteButton
                href={`/community/tutorials/${encodeURIComponent(stored.slug)}`}
                dirty={dirty}
                saving={saving}
                save={save}
                hrefFor={(saved) => (saved.state === "published" && !isEmptyDoc(saved.body) ? `/community/tutorials/${encodeURIComponent(saved.slug)}` : null)}
              />
            )}
            {stored && (
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
          </>
        }
      />

      {stored && (
        <ConfirmActionDialog
          open={deleting}
          onOpenChange={setDeleting}
          title="Delete this tutorial?"
          description="It is removed from the Community page and its web address stops working. Uploaded files stay in the media library."
          detail={stored.title}
          confirmLabel="Delete tutorial"
          pendingLabel="Deleting…"
          successMessage="Tutorial deleted."
          failureMessage="Couldn't delete the tutorial. Try again. If it keeps failing, the service may be unavailable."
          onConfirm={async () => {
            const result = await deleteTutorial(stored.id);
            if (result.ok) return { ok: true };
            if (result.reason === "session_expired") return { ok: false, message: "Your session has expired. Sign in again." };
            if (result.reason === "not_found") return { ok: true };
            return { ok: false, message: result.message };
          }}
          onDone={() => router.replace("/admin/community/tutorials")}
        />
      )}
    </form>
  );
}
