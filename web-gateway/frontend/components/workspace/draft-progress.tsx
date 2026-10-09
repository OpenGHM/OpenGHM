import { Fragment } from "react";
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

// A step's number (or check) in a 28 px disc: green and checked when done, the
// navy disc on the white pill when current, an outline when still ahead.
const DISC = "relative flex size-7 shrink-0 items-center justify-center rounded-full text-[13px]";
const DONE = `${DISC} bg-success text-white`;
const CURRENT = `${DISC} bg-hero font-semibold text-white`;
const AHEAD = `${DISC} border-[1.5px] border-white/30 text-hero-foreground-muted`;

// A step of the strip. The current one is the white pill; the rest are plain
// text on the band, joined by a connector.
const STEP = "flex min-h-10 items-center gap-2.5 rounded-full px-1 text-sm";
const STEP_CURRENT = `${STEP} bg-white py-1.5 pr-3.5 pl-1.5 font-semibold text-foreground`;
const STEP_IDLE = `${STEP} text-hero-foreground-muted`;

/** The line between two steps: green once the step before it is done. */
function Connector({ done = false }: { done?: boolean }) {
  return (
    <li
      aria-hidden="true"
      className={cn("mx-1.5 h-0.5 w-4 shrink-0 sm:mx-2.5 sm:w-9", done ? "bg-success" : "bg-white/20")}
    />
  );
}

/** The strip's frame: the steps in a row on the navy band under the title. */
function Strip({ children }: { children: React.ReactNode }) {
  return (
    <nav aria-label="Steps" className="max-w-full">
      <ol className="flex w-fit max-w-full items-center">{children}</ol>
    </nav>
  );
}

/**
 * The three steps of the draft wizard as a strip on the band under the title:
 * "Start from" is done (a green check) and is not a link (a draft's starting point
 * cannot change; the header says what it was, once). The other two are links to
 * `/workspace/<id>?step=...` (or what `hrefFor` says, for a snapshot draft that is not
 * saved yet); a plain click is handed to `onSelectStep`, which is
 * how the wizard changes step without a page load, and anything else (middle
 * click, a new tab) follows the href. The current one is the white pill, and has
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
      <li className={`min-w-0 ${STEP_IDLE}`}>
        <span className={DONE}>
          <Check className="size-4" aria-hidden="true" />
        </span>
        <span className="sr-only sm:not-sr-only">{START_STEP_LABEL}</span>
        <span className="sr-only">(done)</span>
      </li>
      {DRAFT_STEPS.map((step, i) => {
        const isCurrent = step === current;
        const problem = problemSteps.includes(step);
        return (
          <Fragment key={step}>
            <Connector done={i === 0} />
            <li>
              <Link
                href={hrefOf(step)}
                prefetch={false}
                aria-current={isCurrent ? "step" : undefined}
                onClick={(event) => {
                  // A plain click changes step in place; the rest is the browser's.
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)
                    return;
                  event.preventDefault();
                  onSelectStep(step);
                }}
                className={cn(
                  isCurrent ? STEP_CURRENT : `${STEP_IDLE} transition-colors hover:text-white`,
                  "outline-none focus-visible:ring-2 focus-visible:ring-hero-eyebrow"
                )}
              >
                <span className={isCurrent ? CURRENT : AHEAD}>
                  {i + 2}
                  {problem && (
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-hero-attention ring-2",
                        isCurrent ? "ring-white" : "ring-hero"
                      )}
                    />
                  )}
                </span>
                <span className={isCurrent ? undefined : "sr-only sm:not-sr-only"}>{STEP_LABELS[step]}</span>
                {problem && <span className="sr-only">(needs attention)</span>}
              </Link>
            </li>
          </Fragment>
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
        <span aria-current="step" className={STEP_CURRENT}>
          <span className={CURRENT}>1</span>
          {START_STEP_LABEL}
        </span>
      </li>
      {DRAFT_STEPS.map((step, i) => (
        <Fragment key={step}>
          <Connector />
          <li>
            <span className={STEP_IDLE}>
              <span className={AHEAD}>{i + 2}</span>
              <span className="sr-only sm:not-sr-only">{STEP_LABELS[step]}</span>
            </span>
          </li>
        </Fragment>
      ))}
    </Strip>
  );
}
