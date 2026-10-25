import type { ChangedEntry } from "@/lib/workspace/model-parameters";

/**
 * The list of a draft's parameter changes (`describeChanges`), one line each: the tree's label, the
 * init key and its value, and the readable value ("switched off", an option's label, "2.5 mm") after a
 * dot where it differs from the stored one. A module switched on and a dataset the run copies have no
 * value of their own: they show what was done ("switched on", "copy of <original>, Var_Scale 1.1").
 * Without the tree an entry has no label and shows its key and raw value.
 *
 * Used by the Review step, the submit confirmation and the job page's Run details, so the three
 * cannot drift. Each keeps its own count line and frame around it.
 */
export function ChangeList({ changes }: { changes: readonly ChangedEntry[] }) {
  return (
    <ul className="mt-1 space-y-1">
      {changes.map((change) => (
        <li key={`${change.kind}:${change.path}`} className="min-w-0 text-[13px] font-normal">
          {change.label && <span className="mr-1.5">{change.label}</span>}
          {change.kind !== "change" ? (
            <>
              <code className="font-mono text-xs break-all text-muted-foreground">{change.path}</code>
              <span className="text-muted-foreground"> · {change.shown}</span>
            </>
          ) : (
            <>
              <code className="font-mono text-xs break-all text-muted-foreground">
                {change.path} = {change.value === "" ? "''" : change.value}
              </code>
              {change.shown !== change.value && <span className="text-muted-foreground"> · {change.shown}</span>}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
