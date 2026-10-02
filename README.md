# AroundNet Web

Web tournament manager for **AroundNet** (roundnet). A Next.js app that
reads and writes the **same Supabase backend as the iOS app** — tournaments, groups,
brackets and scores sync live in both directions. Mirrors the iOS design system
(lime-on-black) and calls the same Supabase edge functions for all tournament logic.

## Stack

- Next.js (App Router, TypeScript) — **static export** (`output: "export"`)
- Tailwind CSS v4 (theme in `app/globals.css`)
- Supabase (`@supabase/supabase-js`) — auth (email OTP code), Postgres reads, edge functions, realtime
- MapLibre GL + CARTO dark tiles (no API key)
- Deployed to **GitHub Pages** via GitHub Actions

## Local development

```bash
npm install
npm run dev        # http://localhost:3000
```

The Supabase URL + publishable key are baked in as defaults (public, RLS-protected).
Override with `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` if needed.

## Routing note (static export)

Entity pages use **query-param routing** (`/tournament/?id=…`) rather than dynamic
segments, because `output: "export"` can't pre-render runtime-created ids. Each route
is a real exported page, so refresh/deep-link works on GitHub Pages.

## Deploying to GitHub Pages

1. Create an empty GitHub repo named **`aroundnet-web`** and push this code to `main`.
   (If you use a different repo name or a custom domain, update `NEXT_PUBLIC_BASE_PATH`
   in `.github/workflows/deploy.yml` — set it to `""` for a root/custom-domain site.)
2. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Push to `main`; the workflow builds the static export and deploys it.

### Required Supabase configuration (owner)

- **Email OTP code template:** sign-in uses a 6-digit code (no redirect URLs / PKCE needed —
  correct for a static SPA). The code comes from `{{ .Token }}`, so the **Magic Link** email
  template (Supabase **Auth → Email Templates → Magic Link**) must include it, e.g.
  `Your code: {{ .Token }}`. Without it the email has no code to enter.
- **Row Level Security:** the project currently has RLS **disabled** on `group_matches`
  and `bracket_matches`. Since this app ships the anon key in the browser, enable RLS with
  policies before public launch:
  ```sql
  ALTER TABLE public.group_matches   ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.bracket_matches ENABLE ROW LEVEL SECURITY;
  -- add SELECT + organiser-write policies mirroring the matches/stages tables
  ```

## Reframe editor (`/reframe`)

A standalone tool for reframing a clip — 9:16, 4:5, 1:1 or 16:9, picked in the
editor so you frame against the shape you'll actually get. At 16:9 from 16:9
footage the crop is the whole frame, so it doubles as a trimmer. Scrub to a moment, tap where the action is,
and the output window centres there (stopping at the source edge rather than
showing black bars). Each tap is a keyframe; two or more animate between each
other — and none at all is fine, giving a centred crop. Export renders a real MP4 in the browser via
WebCodecs — no upload, no server. HDR (iPhone HLG) footage is detected
automatically and tone-mapped to SDR by our own WebGL shader rather than the
browser's flat conversion — no colour controls to get wrong.

The timeline is a zoomable detail track over a full-clip overview strip (scroll
to zoom, shift-scroll or drag the lit window to pan).

Long footage is handled with **segments**: mark in/out points around each rally
and the export joins them end to end into one vertical highlight reel. Nothing
is destructive — segments are ranges in the document, the source file is never
touched, and "play segments only" previews the result without committing to it.

Shortcuts are laid out for the left hand, so the right stays on the mouse:

```
A F         mark in / out            1 2 3 4 5 6 speed: reverse · 0.5× · 0.75× · 1× · 1.5× · 2×
S D         speed down / up          G           keyframe at playhead
Q W         frame back / forward     T           play segments only
E R         −1s / +1s                Esc         drop the open in-point
⇧A          force-move the in-point  ⌘Z          undo (⇧⌘Z redo)
```

`S`/`D` step through the same presets the number keys select, so the speed row
always shows which one you are on.

"Play segments only" (`T`) also switches the timeline into **reel view**: the gaps are
collapsed and the ruler reads in exported time, so the timeline matches the rendered
output frame for frame. Segment edges can't be dragged in that mode — a segment's start
sits at a fixed reel position regardless of where it points into the source, so the
handle could never track the pointer. Turn it off to go back to editing the source.

In and Out sit at the outer ends of the home row with the speed keys between them, so a
slip lands on a harmless speed change rather than on the opposite marker. In is also
forgiving: once the playhead is more than a few seconds past an open in-point, pressing
it closes the segment instead of discarding the start of the rally.

Browsers have no native reverse playback, so `1` simulates it by stepping
backwards and will stutter on long-GOP footage; `C` is the smooth alternative.

It shares nothing with the tournament features and has no Supabase or auth
dependency, so it stays out of the way of the rest of the app. The crop math in
`lib/reframe/model.ts` + `solve.ts` is dependency-free and DOM-free by design so
it can be ported to the ARoundNet iOS app; see **`docs/reframe-format.md`** for
the document format, the math, and the AVFoundation mapping.

```bash
node --experimental-strip-types lib/reframe/model.test.ts   # segments + markers + grade
node --experimental-strip-types lib/reframe/solve.test.ts   # crop + interpolation + rotation
node --experimental-strip-types lib/reframe/tonemap.test.ts # HDR→SDR colour pipeline
node --experimental-strip-types lib/compare/model.test.ts   # two-clip sync math + speed ladder
```

## Compare viewer (`/compare`)

Two clips side by side (or stacked), each with its own start/end markers, played
and scrubbed together so you can put your serve next to someone else's — toss
height, arm path, timing into contact.

The sync is **normalised, not elapsed-time**: one master position `u` (0 → 1)
maps into each clip's own marked range, so at any point both clips are at the
same *phase* of the motion even when one serve takes 1.20s and the other 0.95s.
One clip is the **reference** — it defines master time, plays at exactly the
selected speed, and the other gets `speed × (its range / the reference range)`
so both finish together. The longer range is picked as reference on load, so
nothing is ever forced past real time at 1×.

**Playback seeks; it does not play.** One clock advances the master position and
both clips are seeked to it — the elements are never `play()`ed. The obvious
design (play both at matched `playbackRate`s and correct the drift) was tried
first and does not work: two media elements have independent clocks and
decoders, nothing synchronises them, and every correction is either a visible
seek or a rate change that re-primes the decoder. Its failure mode is the pair
*tearing apart*, which is the one thing a comparison tool must not do. The Swift
app reaches the same conclusion by omission — `VideoComparisonView` has no play
button, only a scrubber that seeks both slots.

Seeking from one clock inverts that: both clips are at the same phase by
construction, so drift cannot exist, and the clock stalls while either clip is
still fetching a frame, so running out of decode budget slows the pair down
together. Seeks are issued once per *source* frame rather than once per display
frame, so a 30fps clip at 0.5× asks for 15 a second, not 60.

Each pane also has its own scrub track over its whole duration, independent of
the master — once the ranges are tight, a second of one clip maps onto a second
of the other, which is far too coarse to hunt down a contact frame. A pane moved
that way is marked "off sync" until you snap it back or press play.

A per-clip **alignment nudge** shifts what a clip samples by whole frames
without moving its markers, for the last frame or two of lock-up.

**Zoom and pan** are per pane: scroll on a video to zoom (anchored on the
pointer), drag to move around, double-click to reset. It is a CSS transform on
the element, so it is composited on the GPU and costs nothing per frame. The two
panes zoom independently — the clips are shot from different places, so the
interesting corner is somewhere else in each.

The **viewport shape** (`16:9` / `Fit`) is separate from the shape of the
footage, the same way the Swift `InteractiveVideoPreview` fits the video into a
layout rectangle and clips to that. A 9:16 clip in a 9:16 box gives a tall
sliver to zoom around in; the same clip in a 16:9 box is letterboxed at zoom 1 —
costing nothing, because the height cap already fixes how big the picture is —
and shows far more of it once zoomed. Panning clamps to the *picture*, not the
box, so the bars never come into view.

Keys — left hand only, same idea as the reframe editor:
`Space` play/pause · `A`/`F` mark start/end on the focused clip · `X` swap clip ·
`Q`/`W` ±1 frame (of the focused clip; `⇧` for 10) · `E`/`R` ±0.5s on that clip
alone · `C`/`V` nudge alignment · `S`/`D` speed · `1`–`5` presets (1 = reverse) ·
`L` loop · `Esc` back to the whole clip · `⌘Z` undo.

**Left alone, it recovers.** Object URLs do not survive indefinitely — a browser
will drop the blob behind one, and may freeze or discard an idle tab outright to
save memory. The picked `File` is therefore kept, not just the URL made from it,
so a media error is answered first by minting a fresh URL from the file, which
repairs the common case invisibly. If that fails the file itself has gone (moved,
or evicted by iCloud) and only you can replace it. Either way the markers
survive: they are plain JSON in `localStorage`, offered back on the next visit,
and reapplied to whatever file you open next (`replaceSource`). Playback also
stops when the tab is hidden, since a hidden tab gets no animation frames.

It is a viewer: there is no export. The sync math lives in `lib/compare/model.ts`
and is dependency-free and DOM-free, like the reframe model.

Shared with the reframe editor: `components/video/` (speed ladder, drop zone),
`lib/video/rates.ts` and `lib/hooks/use-raf-coalesce.ts`.

## Project layout

```
app/                    routes (all client components)
  page.tsx              landing: MapLibre + list + filters
  login/ auth/callback/ magic-link sign-in
  tournament/          detail, day console, new, edit, register (query-param ?id=)
  profile/
  reframe/             16:9 → 9:16 keyframed reframe editor
  compare/             two-clip side-by-side comparison viewer
components/             design-system UI + feature components
  ui/                   Button, Card, Chip, Dialog, Tabs, …
  day/                  group + bracket setup dialogs
  reframe/             stage, preview, timeline, inspector, export dialog
  compare/             viewer, pane, per-clip scrub, master timeline
  video/               shared between the two video tools: speed ladder, drop zone
lib/
  supabase/            client, queries, mutations, edge-function wrappers, realtime, types
  hooks/               useTournament (load + realtime), useRafCoalesce (drag coalescing)
  reframe/             portable model + solver + segments, WebCodecs export (mediabunny)
  compare/             portable two-clip sync model
  video/               playback-rate ladder
  types.ts             row aliases + composed view models
```
