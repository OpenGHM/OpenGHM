import { stepHeadingId } from "@/components/workspace/draft-step-heading";
import type { DraftField } from "@/lib/workspace/draft-state";
import type { DraftStep } from "@/lib/workspace/draft-wizard";

const ATTRIBUTE = "data-draft-field";

/** Spread onto the control (or the group) that edits `field`, so that an Edit
 *  link on Review can send focus to it (`focusDraftField`). */
export const draftField = (field: DraftField) => ({ [ATTRIBUTE]: field });

const FOCUSABLE =
  'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * Focus the control marked `draftField(field)`: the element itself when it can
 * take focus, else the first control inside it (a group of checkboxes, a panel
 * with a button). When the step does not render it (a disabled spatial box, no
 * variables to list), focus goes to the step's heading instead.
 */
export function focusDraftField(field: DraftField, step: DraftStep): void {
  const marked = document.querySelector<HTMLElement>(`[${ATTRIBUTE}="${field}"]`);
  const target = marked?.matches(FOCUSABLE) ? marked : (marked?.querySelector<HTMLElement>(FOCUSABLE) ?? null);
  (target ?? document.getElementById(stepHeadingId(step)))?.focus();
}
