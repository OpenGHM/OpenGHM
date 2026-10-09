/**
 * The page numbers a pager draws: all of them while they fit, else the first,
 * the last and the ones around the current page, with `null` standing for a
 * gap ("…"). Pure.
 */
export function pageWindow(page: number, totalPages: number, around = 1): (number | null)[] {
  const wanted = new Set<number>([1, totalPages]);
  for (let p = page - around; p <= page + around; p++) {
    if (p >= 1 && p <= totalPages) wanted.add(p);
  }
  const sorted = [...wanted].sort((a, b) => a - b);
  const out: (number | null)[] = [];
  sorted.forEach((p, i) => {
    const previous = sorted[i - 1];
    if (previous !== undefined && p - previous === 2) out.push(previous + 1);
    else if (previous !== undefined && p - previous > 2) out.push(null);
    out.push(p);
  });
  return out;
}
