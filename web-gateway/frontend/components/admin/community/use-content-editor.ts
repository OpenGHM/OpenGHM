"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { splitFieldErrors } from "@/lib/community/admin-failure";
import { fingerprint, type FormErrors } from "@/lib/community/admin-forms";
import type { ActionResult } from "@/lib/jobs/types";
import { useSaveShortcut, useUnsavedGuard } from "@/components/admin/community/use-editor-guard";

/**
 * The state every Community editor shares: the form, what it would send, the
 * checks and what the backend refused, saving, and whether anything changed
 * since the last save. Nothing is saved by itself: `save` runs from the button
 * or Ctrl or Cmd + S. The checks show only after a first try, so an empty form
 * is not all red; the first field with a problem takes focus.
 *
 * A refusal stays on the page: a 422's messages go beside their fields, any
 * other sentence in `general`, and an ended session in `expired` (the page
 * shows the sign-in banner). Editing a field clears what the backend said, as
 * it is no longer what was sent.
 */
export function useContentEditor<F, I, T>({
  initial,
  toInput,
  validate,
  submit,
  mapServerPath,
  savedMessage,
  onSaved,
}: {
  initial: F;
  toInput: (form: F) => I;
  validate: (form: F) => FormErrors;
  submit: (input: I) => Promise<ActionResult<T>>;
  /** Turns the path of a refused field into the form's own (rows that were blank are not sent). */
  mapServerPath?: (path: string, form: F) => string;
  savedMessage: string;
  onSaved: (saved: T) => void;
}) {
  const [form, setFormState] = useState<F>(initial);
  const [savedFingerprint, setSavedFingerprint] = useState(() => fingerprint(toInput(initial)));
  const [tried, setTried] = useState(false);
  const [server, setServer] = useState<FormErrors>({});
  const [general, setGeneral] = useState<string[]>([]);
  const [expired, setExpired] = useState(false);
  const [saving, setSaving] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const root = useRef<HTMLFormElement>(null);

  const current = useMemo(() => fingerprint(toInput(form)), [form, toInput]);
  const dirty = current !== savedFingerprint;

  const setForm = useCallback((change: Partial<F> | ((form: F) => F)) => {
    setFormState((f) => (typeof change === "function" ? change(f) : { ...f, ...change }));
    setServer({});
  }, []);

  const errors: FormErrors = { ...server, ...(tried ? validate(form) : {}) };

  // The first field marked invalid takes focus, once the marks are on the page.
  useEffect(() => {
    if (focusTick === 0) return;
    root.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusTick]);

  const save = useCallback(async () => {
    if (saving) return;
    setTried(true);
    setGeneral([]);
    setExpired(false);
    if (Object.keys(validate(form)).length > 0) {
      setServer({});
      setFocusTick((n) => n + 1);
      toast.error("Some fields need attention. They are marked below.");
      return;
    }
    setSaving(true);
    const sent = fingerprint(toInput(form));
    try {
      const result = await submit(toInput(form));
      if (result.ok) {
        setSavedFingerprint(sent);
        setServer({});
        toast.success(savedMessage);
        onSaved(result.data);
      } else if (result.reason === "session_expired") {
        setExpired(true);
      } else if (result.reason === "not_found") {
        setGeneral(["This item no longer exists. It may have been deleted in another tab."]);
      } else {
        const split = splitFieldErrors(result);
        const mapped: FormErrors = {};
        for (const [path, message] of Object.entries(split.fields)) {
          mapped[mapServerPath ? mapServerPath(path, form) : path] = message;
        }
        setServer(mapped);
        setGeneral(
          split.general.length > 0
            ? split.general
            : Object.keys(mapped).length > 0
              ? ["The gateway refused some fields. Nothing was saved; fix the ones marked below."]
              : [result.message]
        );
        if (Object.keys(mapped).length > 0) setFocusTick((n) => n + 1);
      }
    } catch {
      setGeneral(["Couldn't save. Nothing was changed; try again."]);
    } finally {
      setSaving(false);
    }
  }, [saving, validate, form, toInput, submit, savedMessage, onSaved, mapServerPath]);

  useUnsavedGuard(dirty);
  useSaveShortcut(() => void save());

  return { form, setForm, errors, general, expired, saving, dirty, save, root };
}
