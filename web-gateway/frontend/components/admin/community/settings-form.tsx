"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Layers, LayoutTemplate } from "lucide-react";
import { Input } from "@/components/ui/input";
import { EditorSection, SaveBar, SaveNotices } from "@/components/admin/community/editor-chrome";
import { Field, TEXTAREA_CLASS, ToggleRow } from "@/components/admin/community/form-bits";
import { useContentEditor } from "@/components/admin/community/use-content-editor";
import { saveAdminSettings } from "@/lib/community/admin-actions";
import { settingsToForm, settingsToInput, validateSettings } from "@/lib/community/admin-forms";
import type { CommunitySettings, CommunitySettingsInput } from "@/lib/community/types";

/**
 * The words at the top of the Community page and the Discussion groups
 * section. Groups can be hidden altogether until they exist. Saves like the
 * editors: by the button or Ctrl or Cmd + S.
 */
export function SettingsForm({ settings }: { settings: CommunitySettings }) {
  const router = useRouter();
  const uid = useId();
  const [initial] = useState(() => settingsToForm(settings));

  const { form, setForm, errors, general, expired, saving, dirty, save, root } = useContentEditor<
    CommunitySettingsInput,
    CommunitySettingsInput,
    CommunitySettings
  >({
    initial,
    toInput: settingsToInput,
    validate: validateSettings,
    submit: saveAdminSettings,
    savedMessage: "Page settings saved.",
    onSaved: () => router.refresh(),
  });

  const id = (name: string) => `${uid}-${name}`;
  const set = (patch: Partial<CommunitySettingsInput>) => setForm(patch);

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

      <EditorSection icon={LayoutTemplate} title="Page heading" description="The title and the line under it at the top of /community.">
        <Field id={id("hero-title")} label="Title" error={errors.hero_title}>
          {(p) => <Input {...p} value={form.hero_title} autoComplete="off" onChange={(e) => set({ hero_title: e.target.value })} />}
        </Field>
        <Field id={id("hero-intro")} label="Introduction" optional error={errors.hero_intro}>
          {(p) => <textarea {...p} value={form.hero_intro} rows={3} className={TEXTAREA_CLASS} onChange={(e) => set({ hero_intro: e.target.value })} />}
        </Field>
      </EditorSection>

      <EditorSection icon={Layers} title="Discussion groups" description="The section about groups that are not open yet, with its “tell me when they open” button.">
        <ToggleRow
          id={id("show")}
          label="Show this section"
          hint="Off, the page has no Discussion groups section and nobody can ask to be told when groups open."
          checked={form.show_groups}
          onChange={(show_groups) => set({ show_groups })}
        />
        <Field id={id("groups-title")} label="Section title" error={errors.groups_title}>
          {(p) => (
            <Input
              {...p}
              value={form.groups_title}
              autoComplete="off"
              disabled={!form.show_groups}
              onChange={(e) => set({ groups_title: e.target.value })}
            />
          )}
        </Field>
        <Field id={id("groups-intro")} label="Introduction" optional error={errors.groups_intro}>
          {(p) => (
            <textarea
              {...p}
              value={form.groups_intro}
              rows={3}
              disabled={!form.show_groups}
              className={`${TEXTAREA_CLASS} disabled:cursor-not-allowed disabled:opacity-50`}
              onChange={(e) => set({ groups_intro: e.target.value })}
            />
          )}
        </Field>
      </EditorSection>

      <SaveBar dirty={dirty} saving={saving} saveLabel="Save settings" cancelHref="/admin/community" />
    </form>
  );
}
