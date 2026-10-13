"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, ImageIcon, Link2, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmActionDialog } from "@/components/admin/confirm-action-dialog";
import { EditorSection, SaveBar, SaveNotices, ViewOnSiteButton } from "@/components/admin/community/editor-chrome";
import { Field, SELECT_CLASS, TEXTAREA_CLASS } from "@/components/admin/community/form-bits";
import { ImageField } from "@/components/admin/community/image-field";
import { RichTextEditor } from "@/components/admin/community/rich-text-editor";
import { useContentEditor } from "@/components/admin/community/use-content-editor";
import { createNews, deleteNews, updateNews } from "@/lib/community/admin-actions";
import { slugify } from "@/lib/community/admin-format";
import {
  emptyNewsForm,
  LIMITS,
  newsToForm,
  newsToInput,
  validateNews,
  type NewsForm,
} from "@/lib/community/admin-forms";
import { isEmptyDoc } from "@/lib/community/admin-richtext";
import type { NewsPost, NewsTag } from "@/lib/community/types";
import { NEWS_TAGS } from "@/lib/home/format";

/**
 * The news post editor, for a new post (`post` null) and a stored one. A post
 * is a card on the home page and `/news`: a tag, a title and summary, an
 * optional cover and a link. With page text it also gets its own page at
 * `/news/<slug>`; without, its card links to the address, if there is one.
 * Saves like the other editors: by the button or Ctrl or Cmd + S, with a guard
 * for unsaved changes. Which posts the home page shows, and in what order, is
 * set on the Latest updates page.
 */
export function NewsEditor({ post }: { post: NewsPost | null }) {
  const router = useRouter();
  const uid = useId();
  const [initial] = useState(() => (post ? newsToForm(post) : emptyNewsForm()));
  const [stored, setStored] = useState<NewsPost | null>(post);
  const [deleting, setDeleting] = useState(false);

  const { form, setForm, errors, general, expired, saving, dirty, save, root } = useContentEditor<
    NewsForm,
    ReturnType<typeof newsToInput>,
    NewsPost
  >({
    initial,
    toInput: newsToInput,
    validate: validateNews,
    submit: (input) => (stored ? updateNews(stored.id, input) : createNews(input)),
    savedMessage: "News post saved.",
    onSaved: (saved) => {
      const created = stored === null;
      setStored(saved);
      if (created) router.replace(`/admin/home/news/${encodeURIComponent(saved.id)}`);
      else router.refresh();
    },
  });

  const id = (name: string) => `${uid}-${name}`;
  const set = (patch: Partial<NewsForm>) => setForm(patch);
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

      <EditorSection icon={Pencil} title="Post" description="The card on the home page and the news page.">
        <Field id={id("title")} label="Title" error={errors.title}>
          {(p) => (
            <Input
              {...p}
              value={form.title}
              autoComplete="off"
              placeholder="Python API v2.0 Released"
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
          hint={`The post's web address, when it has page text: /news/${form.slug || "…"}`}
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
          optional
          hint={`${form.summary.trim().length} of ${LIMITS.newsSummary} characters.`}
          error={errors.summary}
        >
          {(p) => (
            <textarea {...p} value={form.summary} rows={3} className={TEXTAREA_CLASS} onChange={(e) => set({ summary: e.target.value })} />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={id("tag")} label="Tag" hint="Colours the label on the card." error={errors.tag}>
            {(p) => (
              <select {...p} value={form.tag} className={SELECT_CLASS} onChange={(e) => set({ tag: e.target.value as NewsTag })}>
                {NEWS_TAGS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field id={id("date")} label="Date" hint="The newest dates show first. Use YYYY-MM-DD." error={errors.date}>
            {(p) => (
              <Input {...p} value={form.date} autoComplete="off" placeholder="2026-10-10" onChange={(e) => set({ date: e.target.value })} />
            )}
          </Field>
        </div>
      </EditorSection>

      <EditorSection icon={ImageIcon} title="Cover photo" description="Optional. Without one, the card shows a picture of its own.">
        <ImageField
          id={id("cover")}
          value={{ ...form.cover, caption: "" }}
          onChange={(cover) => set({ cover: { url: cover.url, alt: cover.alt } })}
          withCaption={false}
          errors={{ url: errors["cover.url"], alt: errors["cover.alt"] }}
        />
      </EditorSection>

      <EditorSection
        icon={Link2}
        title="Link"
        description="Where the card leads. A post with page text opens its own page and ignores the address. Without either, the card is not a link."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id={id("link-label")}
            label="Link text"
            optional
            hint="Left empty, the link says “Read more”."
            error={errors.link_label}
          >
            {(p) => (
              <Input
                {...p}
                value={form.linkLabel}
                autoComplete="off"
                placeholder="Read more"
                onChange={(e) => set({ linkLabel: e.target.value })}
              />
            )}
          </Field>
          <Field id={id("link-url")} label="Address" optional error={errors.link_url} hint="https:// or a path on this site, like /repository.">
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
      </EditorSection>

      <EditorSection icon={FileText} title="Page text" description="Optional. Write the post here to give it a page of its own.">
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
            placeholder="Write the post…"
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
        saveLabel={stored ? "Save changes" : "Create post"}
        cancelHref="/admin/home/news"
        extra={
          <>
            {stored?.state === "published" && hasPage&& (
              <ViewOnSiteButton
                href={`/news/${encodeURIComponent(stored.slug)}`}
                dirty={dirty}
                saving={saving}
                save={save}
                hrefFor={(saved) => (saved.state === "published" && !isEmptyDoc(saved.body) ? `/news/${encodeURIComponent(saved.slug)}` : null)}
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
          title="Delete this post?"
          description="It is removed from the site and the home page, and its web address stops working. Uploaded files stay in the media library."
          detail={stored.title}
          confirmLabel="Delete post"
          pendingLabel="Deleting…"
          successMessage="Post deleted."
          failureMessage="Couldn't delete the post. Try again. If it keeps failing, the service may be unavailable."
          onConfirm={async () => {
            const result = await deleteNews(stored.id);
            if (result.ok) return { ok: true };
            if (result.reason === "session_expired") return { ok: false, message: "Your session has expired. Sign in again." };
            if (result.reason === "not_found") return { ok: true };
            return { ok: false, message: result.message };
          }}
          onDone={() => router.replace("/admin/home/news")}
        />
      )}
    </form>
  );
}
