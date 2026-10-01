# Gateway frontend

The OpenGHM gateway's web app: Next.js 16 (App Router), React 19,
Tailwind CSS 4, shadcn/ui (new-york, on the `radix-ui` package), lucide-react
icons and sonner toasts. How it fits with the backend is in
[`docs/architecture/gateway.md`](../../docs/architecture/gateway.md); this file
holds the conventions a UI change follows, so the next one has one place to
read.

## Run and check

```bash
just run                  # from the repo root: Docker services, then this app on :3100
npm run dev               # this app alone, on :3100
npx tsc --noEmit
npx vitest run
npx eslint app components lib
```

## Conventions

### Colour comes from tokens

Every colour is a token in [`app/globals.css`](app/globals.css), mapped to
Tailwind in `@theme inline`. Components never use a raw hex value or a hue from
the palette (`bg-red-100`, `text-emerald-700`); neutral greys may stay as
palette classes.

| Token | Use |
|---|---|
| `primary`, `accent` | brand: links, primary buttons, the default card hue |
| `hero` | the navy start of the page heroes (`from-hero to-primary`) |
| `status-*` | one per job status (draft, pending, submitted, running, cancelling, completed, failed, cancelled), applied through [`lib/jobs/status-hue.ts`](lib/jobs/status-hue.ts) |
| `success`, `warning`, `info` | found, caution, note; not a status |
| `compute` | the compute cards (HPC configuration, cores and walltime) |
| `destructive` | errors and destructive actions |

Text in a hue sits on at most a 10% tint of that hue (`bg-status-failed/10
text-status-failed`): that is what keeps it at AA. A new token must pass the
same check.

### The card

Detail-page content is a card with this recipe:

- the card itself is `rounded-xl border-0 shadow-sm`;
- the header is `border-b bg-gradient-to-r from-<hue>/5 to-transparent`, with
  an 8 × 8 `rounded-lg` icon tile in the hue (`bg-<hue>/10`, icon
  `text-<hue>`);
- the body is `CardContent pt-5 pb-6`, and its inset tiles use `bg-muted`.

[`completed-results-card.tsx`](components/workspace/completed-results-card.tsx)
is a clean instance.

### Catalogue list

The Data Repository lists model snapshots and model inputs in one list, with
the type as a filter. Its pieces are in [`components/repository/`](components/repository/).

- The page opens with a mono eyebrow, the h1 and a one-line subtitle. The
  toolbar sits above the results, not in the sidebar: search (`/` focuses it,
  Escape leaves it), a Sort select, and a List / Grid switch. The count
  ("12 results", in an `aria-live` region) and the active-filter chips follow.
- The view is `view=grid` in the URL (the list is the default and is omitted).
  It is a layout of the same results, so changing it neither goes back to page 1
  nor asks the backend again (`inertKeys` in
  [`use-url-filters.ts`](lib/repository/use-url-filters.ts)).
- A list card is a white `rounded-xl` card with a 1px border and no shadow
  (`shadow-md` on hover). From `md` it has the content on the left and a
  260 px coverage map panel the full height of the card on the right; below `md`
  the panel sits under the content, 144 px tall. Metadata is mono: the version
  and licence line, and the Coverage and Resolution values. The title is the
  card's stretched link in the foreground colour; View details is a solid
  `bg-foreground` button, and Download, Cite, the tag chips and the keyword
  chips sit above the stretched link (`relative z-10`) with their own focus
  ring. All of an item's tags come first as primary-tint chips, then the
  mono keyword chips; both are toggle buttons (`aria-pressed`, a check when on,
  40 px tall below `sm`) that add or remove that tag or keyword as a filter.
  A tag shows its readable name ("Ancillary data"); the URL and the API keep
  the raw value (`ancillary-data`). Anywhere else the tags only show, use
  [`TagChips`](components/repository/tag-chips.tsx). A grid card is
  the map on top, then the badge, the title, one mono line and View / Download.
  The map is a real SVG land outline with the bounding box, not a map tile.
- The sidebar is built from the facets the backend returns, in one "Filters"
  card with a Reset link (shown only while something is on; it keeps the sort
  and the view). Groups are separated by rules and open and close with a + / –
  button. A group with no options is hidden, a long one shows six and a "Show
  all" toggle, and counts, shown as plain mono numbers, ignore the group's own
  selection. Spatial resolution is single-select preset chips. Below `lg` the
  card folds behind a "Filters" button; from `lg` it is a column beside the
  results.
- Every filter lives in the URL, a facet as a repeated key
  (`?tag=a&tag=b`), and a change goes back to page 1.

### Every state is designed

- **Loading:** a skeleton shaped like the content
  ([`components/ui/skeleton.tsx`](components/ui/skeleton.tsx)), through a
  route's `loading.tsx` or a `<Suspense>` fallback. Spinners are only for a
  button whose request is in flight.
- **Empty:** a dashed card that says what is missing and what to do next.
- **Error:** an inline box in `destructive` that says what failed and what to
  try, or the route's `error.tsx`.
- **Every job status and every verdict cause** has a view. The dev-only route
  `/dev/workspace/<state>` renders the detail page from
  [`lib/workspace/fixtures.ts`](lib/workspace/fixtures.ts) for each of them,
  and answers 404 in a production build. Real pages never import the fixtures.

### Actions

- On the detail page each action has one home, in the hero, and follows the
  live status: Submit for a draft, Cancel for an active job, New from this
  model snapshot for an ended one, Delete in the More menu.
- A disabled action says why, both in a tooltip and in visible text.
- Submit spends allocation, and Cancel and Delete cannot be undone, so each
  one confirms in an AlertDialog that says what will happen. The dialogs are
  controlled components
  ([`cancel-job-dialog.tsx`](components/workspace/cancel-job-dialog.tsx),
  [`delete-simulation-dialog.tsx`](components/workspace/delete-simulation-dialog.tsx)),
  so a menu item can open them. They stay open while the request is in flight.
- A dialog opened from a DropdownMenu is its sibling, not its child. It is
  opened from the item's `onSelect` through state, the menu is
  `modal={false}`, and focus goes back to the menu's trigger when the dialog
  closes.
- Toasts appear at top-center and confirm what happened. An error that needs
  reading also stays on the page.

### Time

Never format a date during render with `toLocaleString()` and its relatives.
The server runs in UTC and the browser does not, so the text differs and React
throws a hydration error (#418). Use
[`TimeStamp`](components/common/time-stamp.tsx). It prints UTC on the server
and on the first client render, then switches to the viewer's zone. Relative
time ("3 min ago") carries the absolute time in its tooltip.

### Copy

Copy says what happened and what to do next, in the user's words. It never
names a repository path, an ADR, an open item, or an internal value such as
`inherited-missing`. It never says that something is "not wired" or
"illustrative". If a feature does not exist yet, say so plainly; do not show
a mock that looks as if it works.

## The UI checklist

Every UI change passes this list, on every screen and dialog it touches, at
1280 px and at 375 px.

1. **Aligned with the existing design:**
   - the card recipe above;
   - Google Sans, lucide-react icons, and sonner at top-center;
   - shadcn/ui primitives, with no hand-rolled modal;
   - colours from tokens only.
2. **Every state designed:** loading as a skeleton, empty as a dashed card,
   error as an inline box or a route boundary, plus every job status and
   verdict cause.
3. **Destructive or costly actions confirm** in an AlertDialog that says what
   will happen.
4. **Responsive at 375 px:**
   - no horizontal page scroll;
   - touch targets of at least 40 px;
   - tables become stacked rows.
5. **Accessible:**
   - every control is reachable by keyboard, with a visible focus ring;
   - status changes are announced through `aria-live`;
   - `prefers-reduced-motion` stops every pulse and spin (`motion-safe:`);
   - contrast is at least AA.
6. **Time is honest:** relative time has an absolute tooltip, and nothing
   renders differently on the server and the client.
7. **Copy is plain** (see Copy above).
