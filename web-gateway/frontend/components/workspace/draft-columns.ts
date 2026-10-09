/**
 * The columns of a snapshot draft row from `lg` up: name (with its tile), run
 * period, status, updated, delete. One string for the rows, their header and
 * the loading skeleton, so they line up; written whole because Tailwind reads
 * source text. A separate module because the skeleton is a server component
 * and the table a client one. Below `lg` a row is two lines instead: the name,
 * then period, status and time.
 */
export const COLUMNS = "lg:grid-cols-[minmax(0,1fr)_7.25rem_7.5rem_6.5rem_2.5rem]";
