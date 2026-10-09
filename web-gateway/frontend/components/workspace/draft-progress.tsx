import Link from "next/link";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DRAFT_STEPS,
  START_STEP_LABEL,
  STEP_LABELS,
  stepHref,
  type DraftStep,
} from "@/lib/workspace/draft-wizard";

// A step's number (or check) in a small mono disc.
const DISC = "relative flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-xs font-medium";
const DONE = `${DISC} bg-white/15 text-white`;
const CURRENT = `${DISC} bg-hero text-white`;
const AHEAD = `${DISC} border border-white/30 text-hero-foreground-muted`;

// A step as a pill of the strip: the current one is the white segment, as the
// site header's current item is.
const PILL = "flex min-h-10 items-center gap-2 rounded-full px-2.5 text-[13.5px] sm:px-3.5";
const PILL_CURRENT = `${PILL} bg-white font-semibold text-foreground`;
const PILL_IDLE = `${PILL} font-medium text-hero-foreground-muted`;

/** The strip's frame: the header's pill, on the navy band under the title. */
function Strip({ children }: { children: React.ReactNode }) {
  return (
    <nav aria-label="Steps" className="max-w-full">
      <ol className="flex w-fit max-w-full items-center gap-0.5 rounded-full border border-white/10 bg-white/6 p-[5px]">
        {children}
      </ol>
    </nav>
  );
}

/**
 * The three steps of the draft wizard as a pill strip on the band under the title:
 * "Start from" is done (a check) and is not a link (a draft's starting point
 * cannot change; the header says what it was, once). The other two are links to
 * `/workspace/<id>?step=...` (or what `hrefFor` says, for a snapshot draft that is not
 * saved yet); a plain click is handed to `onSelectStep`, which is
 * how the wizard changes step without a page load, and anything else (middle
 * click, a new tab) follows the href. The current one is filled and bold, and has
 * `aria-current="step"`. A step in `problemSteps` carries a dot, and "needs
 * attention" for a screen reader.
 *
 * It is only the strip: the title, the save status and the buttons around it are
 * the wizard's. On a phone only the current step keeps its label.
 */
export function DraftProgress({
  jobId,
  hrefFor,
  current,
  problemSteps,
  onSelectStep,
}: {
  /** The stored draft whose steps these are. */
  jobId?: string;
  /** The address of a step, for a snapshot draft that has no job id yet
   *  (`newStepHref`). Wins over `jobId`. */
  hrefFor?: (step: DraftStep) => string;
  current: DraftStep;
  problemSteps: readonly DraftStep[];
  onSelectStep: (step: DraftStep) => void;
}) {
  const hrefOf = (step: DraftStep) => (hrefFor ? hrefFor(step) : stepHref(jobId ?? "", step));
  return (
    <Strip>
      <li className={`min-w-0 ${PILL_IDLE}`}>
        <span className={DONE}>
          <Check className="size-3.5" aria-hidden="true" />
        </span>
        <span className="sr-only sm:not-sr-only">{START_STEP_LABEL}</span>
        <span className="sr-only">(done)</span>
      </li>
      {DRAFT_STEPS.map((step, i) => {
        const isCurrent = step === current;
        const problem = problemSteps.includes(step);
        return (
          <li key={step}>
            <Link
              href={hrefOf(step)}
              prefetch={false}
              aria-current={isCurrent ? "step" : undefined}
              onClick={(event) => {
                // A plain click changes step in place; the rest is the browser's.
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                event.preventDefault();
                onSelectStep(step);
              }}
              className={cn(
                isCurrent ? PILL_CURRENT : `${PILL_IDLE} transition-colors hover:bg-white/8 hover:text-white`,
                "outline-none focus-visible:ring-2 focus-visible:ring-hero-eyebrow"
              )}
            >
              <span className={isCurrent ? CURRENT : AHEAD}>
                {i + 2}
                {problem && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute -top-1 -right-1 size-2.5 rounded-full bg-amber-500 ring-2",
                      isCurrent ? "ring-white" : "ring-hero"
                    )}
                  />
                )}
              </span>
              <span className={isCurrent ? undefined : "sr-only sm:not-sr-only"}>{STEP_LABELS[step]}</span>
              {problem && <span className="sr-only">(needs attention)</span>}
            </Link>
          </li>
        );
      })}
    </Strip>
  );
}

/**
 * The same strip on the Start screen, before there is a draft: "Start from" is
 * the current step, the other two are ahead and are not links (there is
 * nothing to open yet). On a phone only the current step keeps its label.
 */
export function StartProgress() {
  return (
    <Strip>
      <li>
        <span aria-current="step" className={PILL_CURRENT}>
          <span className={CURRENT}>1</span>
          {START_STEP_LABEL}
        </span>
      </li>
      {DRAFT_STEPS.map((step, i) => (
        <li key={step}>
          <span className={PILL_IDLE}>
            <span className={AHEAD}>{i + 2}</span>
            <span className="sr-only sm:not-sr-only">{STEP_LABELS[step]}</span>
          </span>
        </li>
      ))}
    </Strip>
  );
}
