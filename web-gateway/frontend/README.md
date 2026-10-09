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

`npm run dev` silences one Node deprecation warning, DEP0169 (`url.parse()`):
Next 16.3 calls it from its own code, Node 26 prints it, and the dev overlay
shows it as a console error on the first page. Our own code may not call
`url.parse()`, and ESLint enforces that, so the silenced warning hides nothing
of ours. Only one `--disable-warning` fits: Next rebuilds `NODE_OPTIONS` for
its server process and keeps one value per flag. DEP0205
(`module.register()`, also Next's) still prints once in the terminal. The
image runs `next start` on Node 20 and needs no flag.

## Conventions

### Colour comes from tokens

Every colour is a token in [`app/globals.css`](app/globals.css), mapped to
Tailwind in `@theme inline`. Components never use a raw hex value, an `rgb()`
or `rgba()`, or a hue from the palette (`bg-red-100`, `text-emerald-700`);
neutral greys may stay as palette classes.

| Token | Use |
|---|---|
| `primary`, `primary-hover` | brand: links, primary buttons (`primary-hover` is their hover), the map's bounding box, selection |
| `secondary` | the light brand tint: a snapshot's kind badge, an icon tile, the current item of the phone menu |
| `accent` | hover and focus fill of menu items and ghost buttons; not a brand colour |
| `hero`, `hero-foreground`, `hero-foreground-muted`, `hero-eyebrow` | the navy band at the top of a page and what is written on it: body, muted text, the mono eyebrow. Also the filled "on" state of a switch or chip (`bg-hero text-white`) |
| `hero-text`, `hero-subtle`, `hero-faint` | more text on the band and on the dark code blocks (log, citation, file preview), from read text to meta and breadcrumbs to line numbers and axis ticks; all AA on `hero` |
| `hero-lit`, `hero-glow` | mint for a done or lit thing on the band (a copied check, a timeline's active ticks); the teal-blue glow of the band's corner and where a bar starts |
| `hero-error` | an error written on the band or a dark block (`text-status-failed` is for light surfaces) |
| `data-1` to `data-8` | categorical colours: an output variable's swatch, a process chip's dot (and its tint, `color-mix` at 12%). They tell items apart and mean nothing; never text |
| `map-water` | the sea of an OpenStreetMap tile, behind the bounding-box map |
| `status-*` | one per job status (draft, pending, submitted, running, cancelling, completed, failed, cancelled), applied through [`lib/jobs/status-hue.ts`](lib/jobs/status-hue.ts) |
| `success`, `warning`, `info` | found, caution, note; not a status |
| `compute` | the compute cards (HPC configuration, cores and walltime), and a model input's kind badge |
| `highlight` | data emphasis: a count badge, the snapshot picker's result count; not for actions or selection |
| `destructive` | errors and destructive actions |

Two radii and two shadows belong to the design's surfaces. `rounded-card`
(22 px) is a card, `rounded-panel` (28 px) a large section panel on Home and
About; do not hard-code the pixels. `shadow-card` is a card at rest and
`shadow-raised` one that stands on the band or on a section; `shadow-lift` is a
card's hover and `shadow-float` a button or search box on the band. The band's
dotted texture and soft corner light are the `hero-dots` and `hero-glow`
utilities, on an absolutely positioned layer. The type is Geist, and Geist Mono for eyebrows,
versions, years and other values.

Text in a hue sits on at most a 10% tint of that hue (`bg-status-failed/10
text-status-failed`): that is what keeps it at AA. A new token must pass the
same check.

### Page layout

A page is a navy band and, overlapping its bottom edge, the content
([`components/layout/page-hero.tsx`](components/layout/page-hero.tsx)).

- `PageHero` is the band. It carries the site `Header` itself, so a page using
  it does not render `<Header />`. It takes an eyebrow, a breadcrumb, `meta`, the
  h1, a subtitle, `actions` and `children` (a search box, a section switch). Its
  `size` is `display` for Home, About and the Repository, `page` (a smaller h1)
  for a detail, Workspace or admin page. Workspace pages go through
  [`PageHeader`](components/workspace/page-header.tsx), a `PageHero` at
  `size="page"` that adds a status chip.
- `PageBody` is the content: a `<main>` at most 1360 px wide, pulled 72 px up
  into the band so the first white card starts inside it. The band and the body
  agree on `overlap`.
- `Header` has two variants. `overlay` has no background and sits in a band;
  `standalone` (the default) is its own sticky navy bar, for a page with no band
  (a route's `loading.tsx` or `error.tsx`). The `/auth` pages are neither: they
  are the band filling the viewport around one card
  ([`AuthShell`](components/auth/auth-shell.tsx)).
- A Workspace page with a column beside its content (the draft wizard's help,
  the job page's Run details) puts both in
  [`AsideLayout`](components/workspace/aside-layout.tsx), inside `PageBody`: a
  20 rem `sticky` aside from `xl`, and below `xl` either gone (`below="hidden"`)
  or in the page after `lead` (`below="flow"`).

### The card

A card is [`Card`](components/ui/card.tsx): white, `rounded-card`, a 1px
`border-border/70` and `shadow-card`. A card that overlaps the band, or stands
beside one that does, drops the border and takes `shadow-raised`. A card with a
heading puts it in a `border-b` header: an icon tile (8 × 8, `rounded-[10px]`,
in `bg-secondary`, or in a hue as `bg-<hue>/10` with the icon in `text-<hue>`)
and the title in 17 px semibold. The body is `CardContent pt-5 pb-6`, and its
inset tiles are `rounded-xl bg-muted`.

[`published-answer-card.tsx`](components/workspace/published-answer-card.tsx) is
a clean instance.

### Catalogue list

The Data Repository lists model snapshots and model inputs in one list, with
the type as a filter. Its pieces are in [`components/repository/`](components/repository/).

- The page's band holds the eyebrow, the h1, a one-line subtitle and the search
  box ([`catalogue-search.tsx`](components/repository/catalogue-search.tsx):
  `/` focuses it, Escape leaves it). The query is a filter and applies as it is
  typed; the Search button only moves on to the results. The box reads the query
  from a `CatalogueSearchProvider` that `CatalogueClient` puts around the band.
  One bar over the results holds the count ("12 results", in an `aria-live`
  region), the active-filter chips, a Sort select and a List / Grid switch.
- The view is `view=grid` in the URL (the list is the default and is omitted).
  It is a layout of the same results, so changing it neither goes back to page 1
  nor asks the backend again (`inertKeys` in
  [`use-url-filters.ts`](lib/repository/use-url-filters.ts)).
- A list card is a white `rounded-card` card with no border. From `md` the
  coverage map is a tile on the left, 260 px wide and the height of the card,
  and the content on the right; below `md` the tile is 176 px tall above the
  content. The content, top to bottom: the kind badge, a mono line with the
  version and licence, and the date it was published at the right; the title;
  the description, two lines; three grey boxes (Authors, Coverage, Resolution;
  the last two in mono); then the tag chips and the keyword chips with a "View
  details →" cue at the end. The cue only looks like a button: the title is the
  card's one link, stretched over the whole card (`after:absolute
  after:inset-0`), so clicking anywhere on it opens the detail page. On hover
  (or keyboard focus of the link) the card rises 2px and its shadow deepens, the
  map zooms slightly inside its tile and the cue darkens to `primary-hover`; the
  rise and the zoom are `motion-safe:`, so under reduced motion only the shadow
  and the cue change. When the link has keyboard focus the whole card also wears
  the focus ring. The chips sit above the stretched link (`relative z-10`) with
  their own focus ring. All of an item's tags come first, as outlined chips,
  then the mono keyword chips; both are toggle buttons (`aria-pressed`, a check
  and the `primary` fill when on, 40 px tall below `sm`) that add or remove that
  tag or keyword as a filter. A tag shows its readable name ("Ancillary data");
  the URL and the API keep the raw value (`ancillary-data`). Anywhere else the
  tags only show, use [`TagChips`](components/repository/tag-chips.tsx). A grid
  card is the map on top, then the kind badge, the title, one mono line, a "View
  →" cue and the date; it has no chips. The map
  ([`coverage-thumbnail.tsx`](components/repository/coverage-thumbnail.tsx)) is
  an SVG: white land on a light ground, a graticule, the bounding box and a
  "Global" / "Regional" pill. It makes no tile request.
  Colour has three roles here: `primary` is selection and interaction (checked
  boxes, the slider, pressed chips, the cue, focus), the navy `hero` is the
  filled "on" state (the active view, a Type segment, an active-filter chip),
  and `highlight` is a count badge. Labels at rest (the keyword chips, the grey
  boxes) are neutral.
- Which filter groups exist, their order and their titles are defined once, as
  `CATALOGUE_FILTER_GROUPS` in
  [`lib/repository/catalogue.ts`](lib/repository/catalogue.ts), and each group's
  body is [`CatalogueFilterBody`](components/repository/catalogue-filter-body.tsx).
  The sidebar and the filter panel of the Start screen's snapshot picker
  (`/workspace/new`) are two layouts of that one list. A group's `picker` flag
  says whether the compact picker panel shows it (Tags, Temporal coverage and
  Spatial resolution do). The panel's "More filters" button opens a dialog (a
  sheet) with every group, the compact ones included, in the sidebar's
  collapsible frame ([`CatalogueFilterSection`](components/repository/catalogue-filter-body.tsx));
  its Reset clears the filters and keeps the search, and the button's badge
  counts the active filters only the dialog has. The picker leaves out what it
  fixes (`SNAPSHOT_PICKER_FIXED_FILTERS`, the type), and its URL keeps every other
  filter's key. A filter is added or changed in the definition only; neither
  layout lists a filter or a title of its own.
- The sidebar is built from the facets the backend returns, in one "Filters"
  card with a Reset button (shown only while something is on; it keeps the sort
  and the view). Each group opens and closes with a + / – button. A group that
  opens by default is a section headed by a small uppercase label; one that
  starts closed is a row set off by a rule. A group with no options is hidden, a
  long one shows six and a "Show all" toggle, and each option's count, in a mono
  pill, ignores the group's own selection. Type is a two-segment control rather
  than checkboxes. Spatial resolution has preset chips that put both handles on
  one value, an "All" box, a Unit switch (°, ′, ″; it changes only how the
  numbers are written, not the URL) and a two-handle range slider from 0 to 2°
  with its range written under it. The filter is always in degrees
  (`spatial_res_min` / `spatial_res_max`), and both handles at the ends mean
  no filter. Below `lg` the card folds behind a "Filters" button; from `lg` it is
  a 268 px column beside the results.
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

- On the detail page each action has one home and follows the live status:
  Submit for a draft (on Review & submit), Cancel for an active job (in the
  status summary), and New from this model snapshot and Delete, as visible
  buttons in the page header, for an ended one; on a phone those become one
  "More actions" menu. A list row's Delete is a visible icon button, with no
  "…" menu.
- Nothing in the wizard saves by itself. A new simulation is not stored until
  the user presses Save as draft or submits (`/workspace/new/<snapshot id>`),
  and a stored draft is written by its Save draft button (Ctrl or Cmd + S does
  the same; [ADR 0028](../../docs/decisions/0028-a-new-simulation-is-stored-when-the-user-saves-it.md)).
  Both are the one wizard, and both ask before a link, a reload or the
  browser's Back or Forward throws unsaved input away; Next, Back and the step
  strip, and the browser's Back or Forward between `?step=` entries, never ask.
  Back and Forward are held back by cancelling the Navigation API's `navigate`
  event for a traversal that leaves the wizard (Next's `popstate` listener
  cannot be stopped from the wizard); without that API, or when the browser
  declines to let the Back be cancelled, they are not held back. See
  [`leave-guard.ts`](lib/workspace/leave-guard.ts). Anything new that
  starts a simulation from a snapshot links to the new-simulation route; it does
  not call the derive action itself.
- A draft its snapshot's published output already answers is not submitted:
  Review shows the published files in place of the submit card, and "Run
  anyway" reruns it through the submit confirmation
  ([`published-answer-card.tsx`](components/workspace/published-answer-card.tsx)).
  A failed check never blocks submitting.
- A disabled action says why, both in a tooltip and in visible text.
- Submit spends allocation, and Cancel and Delete cannot be undone, so each
  one confirms in an AlertDialog that says what will happen. The dialogs are
  controlled components
  ([`cancel-job-dialog.tsx`](components/workspace/cancel-job-dialog.tsx),
  [`delete-draft-dialog.tsx`](components/workspace/delete-draft-dialog.tsx)),
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
   - Geist, lucide-react icons, and sonner at top-center;
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
