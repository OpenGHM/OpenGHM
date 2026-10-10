"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, ExternalLink, FileText, Image as ImageIcon, Link2, ListPlus, Paperclip, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmActionDialog } from "@/components/admin/confirm-action-dialog";
import { EditorSection, SaveBar, SaveNotices } from "@/components/admin/community/editor-chrome";
import { Field, TEXTAREA_CLASS } from "@/components/admin/community/form-bits";
import { ImageField } from "@/components/admin/community/image-field";
import { RichTextEditor } from "@/components/admin/community/rich-text-editor";
import { useContentEditor } from "@/components/admin/community/use-content-editor";
import { DetailsEditor, MaterialsEditor, PhotosEditor } from "@/components/admin/community/workshop-sections";
import { createWorkshop, deleteWorkshop, updateWorkshop } from "@/lib/community/admin-actions";
import { slugify } from "@/lib/community/admin-format";
import {
  emptyWorkshopForm,
  LIMITS,
  sentPathToFormPath,
  validateWorkshop,
  workshopToForm,
  workshopToInput,
  type WorkshopForm,
} from "@/lib/community/admin-forms";
import type { Workshop } from "@/lib/community/types";

const FORMAT_SUGGESTIONS = ["Online", "In person", "Hybrid"];

/**
 * The workshop editor, for a new workshop (`workshop` null) and a stored one.
 * Every field of the public workshop page is here: the card text, the dates,
 * the side panel's rows, the cover and gallery photos, materials to download,
 * and the article. Nothing saves by itself; Save (or Ctrl or Cmd + S) writes it,
 * and leaving with unsaved changes asks first. A new workshop opens its own
 * page after the first save.
 */
export function WorkshopEditor({ workshop }: { workshop: Workshop | null }) {
  const router = useRouter();
  const uid = useId();
  const [initial] = useState(() => (workshop ? workshopToForm(workshop) : emptyWorkshopForm()));
  const [stored, setStored] = useState<Workshop | null>(workshop);
  const [deleting, setDeleting] = useState(false);

  const { form, setForm, errors, general, expired, saving, dirty, save, root } = useContentEditor<
    WorkshopForm,
    ReturnType<typeof workshopToInput>,
    Workshop
  >({
    initial,
    toInput: workshopToInput,
    validate: validateWorkshop,
    mapServerPath: sentPathToFormPath,
    submit: (input) => (stored ? updateWorkshop(stored.id, input) : createWorkshop(input)),
    savedMessage: "Workshop saved.",
    onSaved: (saved) => {
      const created = stored === null;
      setStored(saved);
      if (created) router.replace(`/admin/community/workshops/${encodeURIComponent(saved.id)}`);
      else router.refresh();
    },
  });

  const id = (name: string) => `${uid}-${name}`;
  const set = (patch: Partial<WorkshopForm>) => setForm(patch);

  // What is on the site is the last saved version, whatever the form says now.
  const published = stored?.state === "published";

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

      <EditorSection icon={Pencil} title="Workshop" description="The card on the Community page and the title of the workshop page.">
        <Field id={id("title")} label="Title" error={errors.title}>
          {(p) => (
            <Input
              {...p}
              value={form.title}
              autoComplete="off"
              placeholder="First OpenGHM Workshop Announcement"
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  title: e.target.value,
                  // The slug follows the title until someone types a slug of their own.
                  slug: f.slugTouched ? f.slug : slugify(e.target.value),
                }))
              }
            />
          )}
        </Field>
        <Field
          id={id("slug")}
          label="Slug"
          hint={`The workshop's web address: /community/workshops/${form.slug || "…"}`}
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
          hint={`The text on the workshop's card. ${form.summary.trim().length} of ${LIMITS.workshopSummary} characters.`}
          error={errors.summary}
        >
          {(p) => (
            <textarea
              {...p}
              value={form.summary}
              rows={3}
              className={TEXTAREA_CLASS}
              onChange={(e) => set({ summary: e.target.value })}
            />
          )}
        </Field>
      </EditorSection>

      <EditorSection
        icon={CalendarDays}
        title="When and where"
        description="Whether the workshop shows as upcoming or past follows its dates."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={id("date")} label="First day" error={errors.date}>
            {(p) => <Input {...p} type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} />}
          </Field>
          <Field id={id("end-date")} label="Last day" optional error={errors.end_date}>
            {(p) => <Input {...p} type="date" value={form.endDate} onChange={(e) => set({ endDate: e.target.value })} />}
          </Field>
        </div>
        <Field
          id={id("when")}
          label="When, in words"
          optional
          hint="Shown instead of the dates, for example February–March 2027."
          error={errors.when_label}
        >
          {(p) => (
            <Input {...p} value={form.whenLabel} autoComplete="off" onChange={(e) => set({ whenLabel: e.target.value })} />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={id("format")} label="Format" optional error={errors.format}>
            {(p) => (
              <>
                <Input
                  {...p}
                  list={id("format-list")}
                  value={form.format}
                  autoComplete="off"
                  placeholder="Online"
                  onChange={(e) => set({ format: e.target.value })}
                />
                <datalist id={id("format-list")}>
                  {FORMAT_SUGGESTIONS.map((option) => (
                    <option key={option} value={option} />
                  ))}
                </datalist>
              </>
            )}
          </Field>
          <Field id={id("location")} label="Location" optional error={errors.location}>
            {(p) => (
              <Input {...p} value={form.location} autoComplete="off" onChange={(e) => set({ location: e.target.value })} />
            )}
          </Field>
        </div>
      </EditorSection>

      <EditorSection icon={ImageIcon} title="Cover photo" description="Shown at the top of the workshop page and on its card.">
        <ImageField
          id={id("cover")}
          value={form.cover}
          onChange={(cover) => set({ cover })}
          errors={{ url: errors["cover.url"], alt: errors["cover.alt"], caption: errors["cover.caption"] }}
        />
      </EditorSection>

      <EditorSection icon={Link2} title="Sign-up link" description="A button to a form or page. Leave both empty for none.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={id("signup-label")} label="Button text" optional error={errors["signup.label"]}>
            {(p) => (
              <Input
                {...p}
                value={form.signup.label}
                autoComplete="off"
                placeholder="Sign up for updates here!"
                onChange={(e) => set({ signup: { ...form.signup, label: e.target.value } })}
              />
            )}
          </Field>
          <Field id={id("signup-url")} label="Address" optional error={errors["signup.url"]}>
            {(p) => (
              <Input
                {...p}
                value={form.signup.url}
                autoComplete="off"
                spellCheck={false}
                placeholder="https://"
                onChange={(e) => set({ signup: { ...form.signup, url: e.target.value } })}
              />
            )}
          </Field>
        </div>
      </EditorSection>

      <EditorSection
        icon={ListPlus}
        title="Details panel"
        description="Extra rows under When, Format and Location in the panel beside the article."
      >
        <DetailsEditor id={id("details")} rows={form.details} onChange={(details) => set({ details })} errors={errors} />
      </EditorSection>

      <EditorSection icon={ImageIcon} title="Photos" description="A gallery, mostly for a workshop that has happened.">
        <PhotosEditor id={id("photos")} rows={form.photos} onChange={(photos) => set({ photos })} errors={errors} />
      </EditorSection>

      <EditorSection icon={Paperclip} title="Materials" description="Slides, recordings and files people can download or open.">
        <MaterialsEditor id={id("materials")} rows={form.materials} onChange={(materials) => set({ materials })} errors={errors} />
      </EditorSection>

      <EditorSection icon={FileText} title="Page text" description="The article. Its first paragraph shows larger, as the lead.">
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
          />
          {errors.body && (
            <p id={id("body-error")} className="text-xs text-destructive">
              {errors.body}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            A paragraph that is only a link shows as a large link card on the site.
          </p>
        </div>
      </EditorSection>

      <SaveBar
        stateId={id("state")}
        state={form.state}
        onStateChange={(state) => set({ state })}
        dirty={dirty}
        saving={saving}
        saveLabel={stored ? "Save changes" : "Create workshop"}
        extra={
          <>
            {published && stored && (
              <Button asChild variant="outline" className="min-h-10 sm:min-h-9">
                <Link href={`/community/workshops/${encodeURIComponent(stored.slug)}`} target="_blank" rel="noreferrer">
                  <ExternalLink aria-hidden="true" />
                  View on site
                </Link>
              </Button>
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
          title="Delete this workshop?"
          description="It is removed from the Community page and its web address stops working. Uploaded photos and files stay in the media library."
          detail={stored.title}
          confirmLabel="Delete workshop"
          pendingLabel="Deleting…"
          successMessage="Workshop deleted."
          failureMessage="Couldn't delete the workshop. Try again. If it keeps failing, the service may be unavailable."
          onConfirm={async () => {
            const result = await deleteWorkshop(stored.id);
            if (result.ok) return { ok: true };
            if (result.reason === "session_expired") return { ok: false, message: "Your session has expired. Sign in again." };
            if (result.reason === "not_found") return { ok: true };
            return { ok: false, message: result.message };
          }}
          onDone={() => router.replace("/admin/community/workshops")}
        />
      )}
    </form>
  );
}
