/** Bytes as a person reads them: `4096` -> `4.0 KB`. Binary units, as `ls -h` prints. */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/** Bytes in decimal units (1 GB = 10^9 B), the way Anvil's `myquota` reports them. */
export function formatBytesSI(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1000) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let value = n / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

export const RETENTION_DAYS = 30;

/** The day Anvil's purge may take a finished simulation's files, counting from when
 *  the job ended. `null` when the end time is not known. The purge counts from
 *  the last access or modification, so this is the earliest, not a promise. */
export function purgeAround(completedAt: string | null): string | null {
  if (!completedAt) return null;
  const ms = new Date(completedAt).getTime();
  if (Number.isNaN(ms)) return null;
  return new Date(ms + RETENTION_DAYS * 86_400_000).toISOString();
}

/** A whole number with thousands separators: `1234567` -> `1,234,567`. Fixed
 *  to en-US so the server and the browser print the same. */
export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US");
}
