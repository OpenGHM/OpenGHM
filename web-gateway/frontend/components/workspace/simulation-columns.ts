/**
 * The columns of a simulation row from `sm` up: name, status, updated, delete.
 * One string for the rows, their header and the loading skeleton, so they line
 * up; written whole because Tailwind reads source text. A separate module
 * because the skeleton is a server component and the table a client one.
 */
export const COLUMNS = "sm:grid-cols-[minmax(0,1fr)_9rem_7.5rem_2.5rem]";
