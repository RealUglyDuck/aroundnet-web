@AGENTS.md

# aroundnet-web

Workspace rules: `../CLAUDE.md`, `../.claude/rules/backend.md`. Stack and routing notes: `README.md`.

```bash
npm run dev      # http://localhost:3000
npm run build    # static export to out/
npm run lint
npx tsc --noEmit
```

- Same Supabase backend as the apps; tournament logic via edge functions only.
- `app/reframe` + `lib/reframe` read the reframe document format shared with Core — see `docs/reframe-format.md`;
  keep it in sync with `ARoundNetCore/Sources/ARoundNetCore/Reframe/ReframeDocument.swift`.
