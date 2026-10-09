/**
 * A snapshot's title carries its WBM version in the middle ("WBM v2.0.0 CONUS
 * tutorial simulation, 2000–2001"). A list row shows that version as a chip of
 * its own, so the title is read twice: once for the version, once for what is
 * left. Pure; the title the row hangs on hover stays the whole one.
 */
const VERSION = /\bv\d+(?:\.\d+)+(?:[-+][\w.]+)?(?![\w.-])/;

export function splitVersion(title: string): { version: string | null; rest: string } {
  const match = VERSION.exec(title);
  if (!match) return { version: null, rest: title };
  const rest = (title.slice(0, match.index) + title.slice(match.index + match[0].length))
    .replace(/\s+([,;:.])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
  // A title that is nothing but a version keeps itself whole.
  return rest === "" ? { version: null, rest: title } : { version: match[0], rest };
}
