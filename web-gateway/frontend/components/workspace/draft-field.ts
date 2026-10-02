import { stepHeadingId } from "@/components/workspace/draft-step-heading";
import type { DraftField } from "@/lib/workspace/draft-state";
import type { DraftStep } from "@/lib/workspace/draft-wizard";

const ATTRIBUTE = "data-draft-field";
const REVEALS = "data-draft-reveals";

/** Spread onto the control (or the group) that edits `field`, so that an Edit
 *  link on Review can send focus to it (`focusDraftField`). */
export const draftField = (field: DraftField) => ({ [ATTRIBUTE]: field });

/** Spread onto the button that opens a closed part of the step (a
 *  `DraftCollapsible`) holding the controls for `fields`: `focusDraftField`
 *  presses it when a control is not on screen yet. */
export const revealsDraftField = (...fields: DraftField[]) => ({ [REVEALS]: fields.join(" ") });

const FOCUSABLE =
  'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * Focus the control marked `draftField(field)`: the element itself when it can
 * take focus, else the first control inside it (a group of checkboxes, a panel
 * with a button). A control inside a closed part of the step is not rendered:
 * the button that opens it (`revealsDraftField`) is pressed first, and focus
 * follows once React has drawn the part (a click made from an effect is
 * answered when the effect returns, so not before the next microtask). When
 * the step does not render the control at all (a disabled spatial box, no
 * variables to list), focus goes to the step's heading instead.
 */
export function focusDraftField(field: DraftField, step: DraftStep): void {
  const find = () => document.querySelector<HTMLElement>(`[${ATTRIBUTE}="${field}"]`);
  const focus = () => {
    const marked = find();
    const target = marked?.matches(FOCUSABLE) ? marked : (marked?.querySelector<HTMLElement>(FOCUSABLE) ?? null);
    (target ?? document.getElementById(stepHeadingId(step)))?.focus();
  };

  if (!find()) {
    const opener = document.querySelector<HTMLElement>(`[${REVEALS}~="${field}"]`);
    if (opener?.getAttribute("aria-expanded") === "false") {
      opener.click();
      queueMicrotask(focus);
      return;
    }
  }
  focus();
}
