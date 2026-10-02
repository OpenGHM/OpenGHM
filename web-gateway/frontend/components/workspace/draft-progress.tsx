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

const CIRCLE = "relative flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold";
const DONE = `${CIRCLE} bg-primary/10 text-primary`;
const CURRENT = `${CIRCLE} bg-primary text-primary-foreground`;
const AHEAD = `${CIRCLE} border bg-card text-muted-foreground`;

/** The hairline between two steps. */
function Connector() {
  return <span className="mx-0.5 h-px w-4 shrink-0 bg-border sm:mx-1 sm:w-10" aria-hidden="true" />;
}

/** The strip's frame: a slim row under the title, closed by a hairline like the section tabs. */
function Strip({ children }: { children: React.ReactNode }) {
  return (
    <nav aria-label="Steps" className="mt-6 border-b pb-3.5">
      <ol className="flex items-center gap-2">{children}</ol>
    </nav>
  );
}

/**
 * The three steps of the draft wizard as a slim light strip under the title:
 * "Start from" is done (a check) and is not a link (a draft's starting point
 * cannot change; the header says what it was, once). The other two are links to
 * `/workspace/<id>?step=...`; a plain click is handed to `onSelectStep`, which is
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
  current,
  problemSteps,
  onSelectStep,
}: {
  jobId: string;
  current: DraftStep;
  problemSteps: readonly DraftStep[];
  onSelectStep: (step: DraftStep) => void;
}) {
  return (
    <Strip>
      <li className="flex min-w-0 items-center gap-2">
        <span className={DONE}>
          <Check className="size-3.5" aria-hidden="true" />
        </span>
        <span className="sr-only text-[13px] font-medium text-muted-foreground sm:not-sr-only">{START_STEP_LABEL}</span>
        <span className="sr-only">(done)</span>
        <Connector />
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
              className="flex min-h-10 items-center gap-2 rounded-md px-1 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:min-h-8"
            >
              <span className={isCurrent ? CURRENT : AHEAD}>
                {i + 2}
                {problem && (
                  <span
                    aria-hidden="true"
                    className="absolute -right-1 -top-1 size-2.5 rounded-full bg-amber-500 ring-2 ring-background"
                  />
                )}
              </span>
              <span
                className={cn(
                  "text-[13px]",
                  isCurrent ? "font-semibold text-foreground" : "sr-only font-medium text-muted-foreground sm:not-sr-only"
                )}
              >
                {STEP_LABELS[step]}
              </span>
              {problem && <span className="sr-only">(needs attention)</span>}
            </Link>
            {i < DRAFT_STEPS.length - 1 && <Connector />}
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
      <li className="flex items-center gap-2">
        <span aria-current="step" className="flex min-h-8 items-center gap-2">
          <span className={CURRENT}>1</span>
          <span className="text-[13px] font-semibold text-foreground">{START_STEP_LABEL}</span>
        </span>
        <Connector />
      </li>
      {DRAFT_STEPS.map((step, i) => (
        <li key={step} className="flex items-center gap-2">
          <span className="flex min-h-8 items-center gap-2">
            <span className={AHEAD}>{i + 2}</span>
            <span className="sr-only text-[13px] font-medium text-muted-foreground sm:not-sr-only">
              {STEP_LABELS[step]}
            </span>
          </span>
          {i < DRAFT_STEPS.length - 1 && <Connector />}
        </li>
      ))}
    </Strip>
  );
}
