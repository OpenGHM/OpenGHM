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
  snapshot for an ended one, Delete in the More menu.
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
