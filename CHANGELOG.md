# Changelog

## 1.0.0 — 2026-06-28

First stable release of Study Buddy for YouTube.

### Extension

- Playlist duration totals at 1×, 1.25×, 1.5×, and 2× on playlist pages
- AI chapters via two-pass Gemini generation (boundary detection → titling)
- Native YouTube chapters used when available (no AI call)
- Chapter seek, copy-to-clipboard, and persistent generation progress
- SPA navigation handling with stale-video refresh prompt
- Chapter regeneration with reason validation, daily quota, and per-video cooldown
- Like/dislike feedback after regeneration with staging persistence
- Inline regenerate form (extension-popup-safe; no overlay bleed)

### Backend

- `POST /api/chapters` — global DB cache + Gemini generation with concurrency lock
- `POST /api/regenerate` — quota, cooldown, reason validation, staging
- `POST /api/regenerate/feedback` — promote or discard staged chapters
- `GET /api/regenerate/quota` — daily limits and cooldown status
- PostgreSQL persistence for chapters, user chapters, quota, cooldown, and staging

### Docs

- [SMOKE_TEST.md](./SMOKE_TEST.md) — manual test plan
- [PRIVACY.md](./PRIVACY.md) — privacy policy
- [STORE_CHECKLIST.md](./STORE_CHECKLIST.md) — Chrome Web Store submission checklist
