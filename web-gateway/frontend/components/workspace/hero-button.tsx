import { AlertCircle } from "lucide-react";

/**
 * Button classes that read on the detail page's dark hero (`from-hero to-primary`),
 * where the outline variant is a white button with dark text. Laid over a
 * `Button` with `variant="outline"`; brings its own focus ring, since the
 * default ring is too faint on navy.
 */
// An outline, not the ring: the ring is a box-shadow, which `shadow-none`
// on the secondary buttons would cancel.
const FOCUS =
  "focus-visible:border-white focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-white";

export const HERO_BUTTON = {
  /** A translucent outline: the hero's menu button. */
  secondary: `border-white/30 bg-white/10 text-white shadow-none hover:bg-white/20 hover:text-white ${FOCUS}`,
} as const;

/** A note under the hero's buttons (an error): a light box, because the status
 *  and destructive text colours are too dark for the navy. Add the text colour. */
export const HERO_NOTE = "rounded-lg bg-white p-3 text-sm";

/** An action that did not go through, under the hero's buttons. */
export function HeroError({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className={`flex items-start gap-2 text-status-failed sm:max-w-md ${HERO_NOTE}`}>
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p className="min-w-0 break-words">{children}</p>
    </div>
  );
}
