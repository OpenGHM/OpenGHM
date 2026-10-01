import { AlertCircle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  RUN_START_UNCHECKED,
  runStartRuleText,
  type RunStartAlignment,
  type RunStartProblem,
} from "@/lib/jobs/run-start";

/**
 * What the Start date may be, under the date fields: the rule in plain words,
 * and, when the start breaks it, the problem in `destructive` text with the
 * nearest valid start as a one-click fix. The field points at it with
 * `aria-describedby={id}`; the region is `aria-live`, so a problem is announced
 * as it appears. Says nothing when the model's init set no rule.
 */
export function RunStartNote({
  id,
  alignment,
  problem,
  onUseSuggestion,
}: {
  id: string;
  alignment: RunStartAlignment;
  problem: RunStartProblem | null;
  onUseSuggestion: (start: string) => void;
}) {
  const rule = runStartRuleText(alignment);
  return (
    <div id={id} aria-live="polite" className="space-y-2">
      {problem ? (
        <div className="flex flex-col gap-2 rounded-lg bg-status-failed/10 p-3 text-xs text-status-failed sm:flex-row sm:items-center sm:justify-between">
          <p className="flex min-w-0 items-start gap-2">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 break-words">{problem.message}</span>
          </p>
          {problem.suggestion && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-10 shrink-0 bg-white sm:min-h-8"
              onClick={() => onUseSuggestion(problem.suggestion as string)}
            >
              Start on {problem.suggestion} instead
            </Button>
          )}
        </div>
      ) : rule ? (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>{rule}</span>
        </p>
      ) : alignment === null ? (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>{RUN_START_UNCHECKED}</span>
        </p>
      ) : null}
    </div>
  );
}
