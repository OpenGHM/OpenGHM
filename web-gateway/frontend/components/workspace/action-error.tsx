import { AlertCircle } from "lucide-react";

/** An action that did not go through (a delete, a new draft), shown under the page header's buttons. */
export function ActionError({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-status-failed sm:max-w-md"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p className="min-w-0 break-words">{children}</p>
    </div>
  );
}
