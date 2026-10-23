import type { CheckFinding } from "@/lib/jobs/types";
import type { DraftField, SubmitProblem } from "@/lib/workspace/draft-state";
import { FIELD_STEP } from "@/lib/workspace/draft-wizard";

/** The init key paths of the two run period inputs. */
const RUN_START = "MT_Code_Name.Run_Start";
const RUN_END = "MT_Code_Name.Run_End";

/**
 * The field of the wizard that mends a failed rule, from the init key paths it concerns: the
 * run start or end, else the output variables, else a model parameter (a key the draft
 * changed, or a spin-up date, which the Model parameters section holds). None when the rule
 * is about what the snapshot's own init says and no field of the draft changes it.
 */
export function checkField(
  paths: readonly string[],
  customParams: Record<string, string> | null
): DraftField | undefined {
  if (paths.includes(RUN_START)) return "start";
  if (paths.includes(RUN_END)) return "end";
  if (paths.includes("Output_vars")) return "variables";
  if (paths.some((p) => p.startsWith("Spinup.") || (customParams !== null && p in customParams))) return "custom";
  return undefined;
}

/** The errors among the checks as problems the submit card lists: each with a Fix link
 *  to the field that mends it, or none when no field does. */
export function checkProblems(
  errors: readonly CheckFinding[],
  customParams: Record<string, string> | null
): SubmitProblem[] {
  return errors.map((error) => {
    const field = checkField(error.paths, customParams);
    return field
      ? { field, step: FIELD_STEP[field], message: error.message }
      : { step: "run", message: error.message };
  });
}

/** What the checks say about the run period, one text for each date input: the messages of
 *  the findings that concern that date, joined. Null when nothing does. */
export function dateMessages(findings: readonly CheckFinding[]): { start: string | null; end: string | null } {
  const about = (path: string) => {
    const messages = findings.filter((f) => f.paths.includes(path)).map((f) => f.message);
    return messages.length > 0 ? messages.join(" ") : null;
  };
  return { start: about(RUN_START), end: about(RUN_END) };
}
