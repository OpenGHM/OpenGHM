/**
 * The Start screen's cards that can be chosen today, and the URL that names
 * one: `/workspace/new?from=copy`. The default, a model snapshot, is not
 * written. No React here, so the server page can read it too.
 */
export type StartMode = "snapshot" | "copy";

const START_PATH = "/workspace/new";

/** `?from=` as Next hands it over. Anything but `copy` is the default. */
export function parseFrom(raw: string | null | undefined): StartMode {
  return raw === "copy" ? "copy" : "snapshot";
}

export function modeHref(mode: StartMode): string {
  return mode === "snapshot" ? START_PATH : `${START_PATH}?from=${mode}`;
}
