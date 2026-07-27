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

## Project layout

```
app/                    routes (all client components)
  page.tsx              landing: MapLibre + list + filters
  login/ auth/callback/ magic-link sign-in
  tournament/          detail, day console, new, edit, register (query-param ?id=)
  profile/
components/             design-system UI + feature components
  ui/                   Button, Card, Chip, Dialog, Tabs, …
  day/                  group + bracket setup dialogs
lib/
  supabase/            client, queries, mutations, edge-function wrappers, realtime, types
  hooks/               useTournament (load + realtime)
  types.ts             row aliases + composed view models
```
