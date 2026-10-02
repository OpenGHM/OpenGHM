import Link from "next/link";
import { Check } from "lucide-react";
import {
  DRAFT_STEPS,
  START_STEP_LABEL,
  STEP_LABELS,
  stepHref,
  type DraftStep,
} from "@/lib/workspace/draft-wizard";

const CIRCLE = "relative flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold";

/**
 * The four steps of the draft wizard as a strip, for the wizard's hero
 * (`from-hero to-primary`, so the text is white): "Start from" is done and is
 * not a link (a draft's starting point cannot change), and "Started from:
 * <snapshot>" says what it was. The other three are links to
 * `/workspace/<id>?step=...`; a plain click is handed to `onSelectStep`, which is
 * how the wizard changes step without a page load, and anything else (middle
 * click, a new tab) follows the href. The current one has `aria-current="step"`.
 * A step in `problemSteps` carries a dot, and "needs attention" for a screen
 * reader.
 *
 * It is only the strip: the title, the save status and the menu around it are
 * the wizard's. On a phone only the current step keeps its label.
 */
export function DraftProgress({
  jobId,
  current,
  snapshotTitle,
  problemSteps,
  onSelectStep,
}: {
  jobId: string;
  current: DraftStep;
  snapshotTitle: string;
  problemSteps: readonly DraftStep[];
  onSelectStep: (step: DraftStep) => void;
}) {
  return (
    <nav aria-label="Steps">
      <ol className="flex items-center gap-2">
        <li className="flex min-w-0 items-center gap-2">
          <span className={`${CIRCLE} bg-white/30 text-white`}>
            <Check className="size-3.5" aria-hidden="true" />
          </span>
          <span className="min-w-0 sr-only sm:not-sr-only">
            <span className="block text-xs font-medium text-white/70">{START_STEP_LABEL}</span>
            <span className="block max-w-48 truncate text-[11px] text-white/60">
              Started from: {snapshotTitle}
            </span>
          </span>
          <span className="mx-0.5 h-px w-3 shrink-0 bg-white/20 sm:mx-1 sm:w-8" aria-hidden="true" />
        </li>
        {DRAFT_STEPS.map((step, i) => {
          const isCurrent = step === current;
          const problem = problemSteps.includes(step);
          return (
            <li key={step} className="flex items-center gap-2">
              <Link
                href={stepHref(jobId, step)}
                prefetch={false}
                aria-current={isCurrent ? "step" : undefined}
                onClick={(event) => {
                  // A plain click changes step in place; the rest is the browser's.
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                  event.preventDefault();
                  onSelectStep(step);
                }}
                className="flex min-h-10 items-center gap-2 rounded-md px-1 outline-none focus-visible:ring-[3px] focus-visible:ring-white/70 sm:min-h-8"
              >
                <span
                  className={`${CIRCLE} ${isCurrent ? "bg-white text-primary" : "bg-white/10 text-white/70"}`}
                >
                  {i + 2}
                  {problem && (
                    <span
                      aria-hidden="true"
                      className="absolute -right-1 -top-1 size-2.5 rounded-full bg-amber-300 ring-2 ring-hero"
                    />
                  )}
                </span>
                <span
                  className={`text-xs font-medium ${
                    isCurrent ? "text-white" : "sr-only text-white/70 sm:not-sr-only"
                  }`}
                >
                  {STEP_LABELS[step]}
                </span>
                {problem && <span className="sr-only">(needs attention)</span>}
              </Link>
              {i < DRAFT_STEPS.length - 1 && (
                <span className="mx-0.5 h-px w-3 shrink-0 bg-white/20 sm:mx-1 sm:w-8" aria-hidden="true" />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * The same strip on the Start screen, before there is a draft: "Start from" is
 * the current step, the other three are ahead and are not links (there is
 * nothing to open yet). On a phone only the current step keeps its label.
 */
export function StartProgress() {
  return (
    <nav aria-label="Steps">
      <ol className="flex items-center gap-2">
        <li className="flex items-center gap-2">
          <span aria-current="step" className="flex min-h-8 items-center gap-2">
            <span className={`${CIRCLE} bg-white text-primary`}>1</span>
            <span className="text-xs font-medium text-white">{START_STEP_LABEL}</span>
          </span>
          <span className="mx-0.5 h-px w-3 shrink-0 bg-white/20 sm:mx-1 sm:w-8" aria-hidden="true" />
        </li>
        {DRAFT_STEPS.map((step, i) => (
          <li key={step} className="flex items-center gap-2">
            <span className="flex min-h-8 items-center gap-2">
              <span className={`${CIRCLE} bg-white/10 text-white/70`}>{i + 2}</span>
              <span className="sr-only text-xs font-medium text-white/70 sm:not-sr-only">
                {STEP_LABELS[step]}
              </span>
            </span>
            {i < DRAFT_STEPS.length - 1 && (
              <span className="mx-0.5 h-px w-3 shrink-0 bg-white/20 sm:mx-1 sm:w-8" aria-hidden="true" />
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
