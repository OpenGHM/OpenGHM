/**
 * Which log lines look like trouble. A pure, conservative guess from the words
 * on the line: a log carries no severity field, so this is a hint to find the
 * cause by eye, never a verdict (the failure card holds the classified cause).
 * An error is red in the log view, a warning is amber, everything else plain.
 *
 * SLURM's own error lines (`sbatch: error: …`, `slurmstepd: error: …`,
 * `srun: error: …`) need no pattern of their own: they carry the word.
 */
export type LineSeverity = "error" | "warning";

/** `\w*` in front of `error` and `exception` takes in Python's class names
 *  (`ValueError: …`, `FileNotFoundException`), where the line itself is the
 *  cause and `Traceback` is only the header. "errors" and "error_count" are
 *  not words ending in `error`, so "0 errors" stays plain.
 *
 *  Counters are not failures: the toolkit's summary line on a healthy run reads
 *  "downloaded 34, skipped 32960, failed 0", so `fail…` does not match when a
 *  zero sits next to it ("failed 0", "failed: 0", "0 failed"). `exit` with a
 *  non-zero code is the toolkit's own box around a step that did not succeed. */
const ERROR =
  /\b(?:\w*error|\w*exception|fatal|(?<!\b0\s)fail(?:ed|ure)?(?!\s*[:=]?\s*0\b)|traceback|segmentation fault|oom_kill|out of memory|killed|abort(?:ed)?|core dumped)\b|\bexit\s+(?:code\s+)?-?[1-9]\d*\b/i;

/** `warn`, `warning`, and Python's `UserWarning`. */
const WARNING = /\b\w*warn(?:ing)?\b/i;

/** The severity of one line, or `null` for a plain one. */
export function lineSeverity(line: string): LineSeverity | null {
  if (ERROR.test(line)) return "error";
  if (WARNING.test(line)) return "warning";
  return null;
}
