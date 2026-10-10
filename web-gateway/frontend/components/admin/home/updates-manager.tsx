"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, ListFilter, Pin, SlidersHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { EditorSection, SaveBar, SaveNotices } from "@/components/admin/community/editor-chrome";
import { Field, ToggleRow } from "@/components/admin/community/form-bits";
import { useContentEditor } from "@/components/admin/community/use-content-editor";
import { PinPicker } from "@/components/admin/home/pin-picker";
import { PinnedList } from "@/components/admin/home/pinned-list";
import { UpdatesPreview } from "@/components/admin/home/updates-preview";
import { saveHomeSettings } from "@/lib/home/admin-actions";
import {
  homeToForm,
  homeToInput,
  pinRowFromItem,
  validateHome,
  type HomeForm,
} from "@/lib/home/admin-forms";
import { pinKey } from "@/lib/home/format";
import { COUNT_MAX, COUNT_MIN, PINS_MAX } from "@/lib/home/settings";
import type { FeedItem, HomeSources, HomeUpdatesAdmin, HomeUpdatesSettingsInput } from "@/lib/home/types";

const SOURCES: { key: keyof HomeSources; label: string; hint: string }[] = [
  { key: "news", label: "News posts", hint: "The newest published news posts." },
  { key: "workshops", label: "Workshops", hint: "Workshops, by when they were announced." },
  { key: "datasets", label: "Datasets", hint: "Public datasets, by when they were added to the repository." },
];

/**
 * The home page's "Latest Datasets & News" section: its words and size, which
 * sources feed it, what it shows now, and the pinned items. By default it
 * shows the newest items; a pinned item shows first, in the order given here,
 * whether or not its source is on. The preview is the saved state; the rest is
 * a form that saves with the button or Ctrl or Cmd + S, like the other editors.
 * Pinning from the News and Workshops lists saves at once, on its own.
 */
export function UpdatesManager({
  settings,
  preview,
}: {
  settings: HomeUpdatesAdmin;
  /** The cards the home page shows for the saved settings; null when they could not be read. */
  preview: FeedItem[] | null;
}) {
  const router = useRouter();
  const uid = useId();
  const [initial] = useState(() => homeToForm(settings));

  const { form, setForm, errors, general, expired, saving, dirty, save, root } = useContentEditor<
    HomeForm,
    HomeUpdatesSettingsInput,
    HomeUpdatesAdmin
  >({
    initial,
    toInput: homeToInput,
    validate: validateHome,
    submit: saveHomeSettings,
    savedMessage: "Home page updates saved.",
    onSaved: () => router.refresh(),
  });

  const id = (name: string) => `${uid}-${name}`;
  const pinnedKeys = new Set(form.pins.map(pinKey));
  const count = Number(form.count) >= COUNT_MIN && Number(form.count) <= COUNT_MAX ? Number(form.count) : settings.count;

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

      <EditorSection
        icon={Eye}
        title="What the home page shows now"
        description="The saved settings, as visitors see them: pinned items first, then the newest."
      >
        <UpdatesPreview items={preview} />
        {dirty && <p className="text-xs text-muted-foreground">You have unsaved changes. Save to update this list.</p>}
      </EditorSection>

      <EditorSection icon={SlidersHorizontal} title="Section" description="The words above the cards, and how many cards there are.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={id("eyebrow")} label="Label" hint="The small line above the title." error={errors.eyebrow}>
            {(p) => <Input {...p} value={form.eyebrow} autoComplete="off" onChange={(e) => setForm({ eyebrow: e.target.value })} />}
          </Field>
          <Field id={id("title")} label="Title" error={errors.title}>
            {(p) => <Input {...p} value={form.title} autoComplete="off" onChange={(e) => setForm({ title: e.target.value })} />}
          </Field>
        </div>
        <Field
          id={id("count")}
          label="Number of cards"
          hint={`From ${COUNT_MIN} to ${COUNT_MAX}. Pinned items count towards it.`}
          error={errors.count}
          className="max-w-40"
        >
          {(p) => (
            <Input
              {...p}
              type="number"
              inputMode="numeric"
              min={COUNT_MIN}
              max={COUNT_MAX}
              step={1}
              value={form.count}
              autoComplete="off"
              onChange={(e) => setForm({ count: e.target.value })}
            />
          )}
        </Field>
      </EditorSection>

      <EditorSection
        icon={ListFilter}
        title="Sources"
        description="Where the newest items come from. A pinned item shows even when its source is off."
      >
        {SOURCES.map((source) => (
          <ToggleRow
            key={source.key}
            id={id(`source-${source.key}`)}
            label={source.label}
            hint={source.hint}
            checked={form.sources[source.key]}
            onChange={(on) => setForm((f) => ({ ...f, sources: { ...f.sources, [source.key]: on } }))}
          />
        ))}
      </EditorSection>

      <EditorSection
        icon={Pin}
        title="Pinned"
        description={`Items that keep showing first, in this order, even when they are older. At most ${PINS_MAX}.`}
      >
        <PinnedList pins={form.pins} count={count} onChange={(pins) => setForm({ pins })} />
        {errors.pins && <p className="text-xs text-destructive">{errors.pins}</p>}
      </EditorSection>

      <EditorSection icon={Pin} title="Add a pin" description="Search the newest news posts, workshops and datasets.">
        <PinPicker
          pinned={pinnedKeys}
          full={form.pins.length >= PINS_MAX}
          onPin={(item) => setForm((f) => ({ ...f, pins: [...f.pins, pinRowFromItem(item)] }))}
        />
      </EditorSection>

      <SaveBar dirty={dirty} saving={saving} saveLabel="Save changes" cancelHref="/admin" />
    </form>
  );
}
