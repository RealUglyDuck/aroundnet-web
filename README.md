# AroundNet Web

Web tournament manager for **AroundNet** (Roundnet/Spikeball). A Next.js app that
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

A standalone tool for turning a landscape clip into a vertical one: scrub to a
moment, tap where the action is, and the 9:16 window centres there (stopping at
the source edge rather than showing black bars). Each tap is a keyframe; two or
more animate between each other. Export renders a real MP4 in the browser via
WebCodecs — no upload, no server. HDR (iPhone HLG) footage is tone-mapped to
SDR by our own WebGL shader rather than the browser's flat conversion, with a
Colour panel (exposure/contrast/saturation/tone map) saved in the document.

The timeline is a zoomable detail track over a full-clip overview strip (scroll
to zoom, shift-scroll or drag the lit window to pan).

Long footage is handled with **segments**: mark in/out points around each rally
and the export joins them end to end into one vertical highlight reel. Nothing
is destructive — segments are ranges in the document, the source file is never
touched, and "play segments only" previews the result without committing to it.

Shortcuts are laid out for the left hand, so the right stays on the mouse:

```
A F         mark in / out            1 2 3 4 5   speed: reverse · 0.5× · 1× · 1.5× · 2×
S D         speed down / up          G           keyframe at playhead
Q W         frame back / forward     T           play segments only
E R         −1s / +1s                Esc         drop the open in-point
⇧A          force-move the in-point  ⌘Z          undo (⇧⌘Z redo)
```

`S`/`D` step through the same five presets the number keys select, so the speed row
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
```

## Project layout

```
app/                    routes (all client components)
  page.tsx              landing: MapLibre + list + filters
  login/ auth/callback/ magic-link sign-in
  tournament/          detail, day console, new, edit, register (query-param ?id=)
  profile/
  reframe/             16:9 → 9:16 keyframed reframe editor
components/             design-system UI + feature components
  ui/                   Button, Card, Chip, Dialog, Tabs, …
  day/                  group + bracket setup dialogs
  reframe/             stage, preview, timeline, inspector, export panel
lib/
  supabase/            client, queries, mutations, edge-function wrappers, realtime, types
  hooks/               useTournament (load + realtime)
  reframe/             portable model + solver + segments, WebCodecs export (mediabunny)
  types.ts             row aliases + composed view models
```
