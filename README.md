# Study Buddy for YouTube

Chrome Extension (Manifest V3) that helps you consume long YouTube playlists and videos efficiently.

## Features

- **Playlist Duration** — Total watch time at 1×, 1.25×, 1.5×, and 2× on playlist pages
- **AI Chapters** — Semantic chapters with timestamps for any captioned video
- **Native Chapters** — Uses creator-added YouTube chapters when available (no AI call)
- **Regenerate** — Request better chapters with a short reason; daily quota and feedback flow
- **Caching** — Local cache for playlists, transcripts, and chapters; server DB cache for AI chapters

## Tech Stack

- Chrome Extension Manifest V3 (React popup, service worker, content scripts)
- TypeScript + React + Vite + Tailwind CSS
- Node.js backend (Hono + PostgreSQL) with **Gemini 2.5 Flash**
- Chrome Storage API

## Setup

### 1. Backend

```bash
cd server
cp .env.example .env
# Set DATABASE_URL, GEMINI_API_KEY, EXTENSION_API_TOKEN
npm install
npm run db:migrate
npm run dev
```

The API runs at `http://localhost:3001`.

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Health check |
| `/api/chapters` | POST | Generate or return cached chapters |
| `/api/regenerate` | POST | Regenerate chapters with reason |
| `/api/regenerate/feedback` | POST | Like/dislike feedback on regeneration |
| `/api/regenerate/quota` | GET | Daily quota and cooldown status |

### 2. Extension

```bash
cp .env.example .env
# VITE_API_BASE_URL and VITE_EXTENSION_API_TOKEN must match server
npm install
npm run build
```

Load the `dist/` folder as an unpacked extension in `chrome://extensions`.

### Production

1. Deploy `server/` with `DATABASE_URL`, `GEMINI_API_KEY`, and `EXTENSION_API_TOKEN`
2. Run migrations: `npm run db:migrate`
3. Build the extension:

```bash
VITE_API_BASE_URL=https://api.yourdomain.com VITE_EXTENSION_API_TOKEN=your-token npm run build
npm run package   # creates study-buddy-for-youtube.zip
```

## Usage

### Playlist Duration

Open any YouTube playlist (`/playlist?list=...`), click the extension icon, and expand **Playlist duration**.

### AI Chapters

1. Start the backend server
2. Open a YouTube video (`/watch?v=...`)
3. Click the extension icon and expand **AI chapters**

Chapter resolution order:

1. **YouTube native chapters** — shown as-is
2. **Local extension cache** — if transcript unchanged
3. **Server DB cache** — if previously generated for this video
4. **Transcript → AI** — two-pass Gemini (boundaries, then titles)

Click any chapter to seek. Use **Regenerate** on AI chapters to request improvements (subject to daily quota).

## Architecture

```
Popup
  → Service Worker
    → Content script (transcript + native chapters on youtube.com)
    → POST /api/chapters | /api/regenerate
  → Chapters returned to popup
```

Users never provide API keys. The backend holds the Gemini key and validates requests with a shared extension token.

## Testing

See [SMOKE_TEST.md](./SMOKE_TEST.md) for the full manual test plan.

## Permissions

| Permission | Purpose |
|---|---|
| `storage` | Cache data locally |
| `tabs` | Relay seek commands to the active YouTube tab |
| `youtube.com` | Content scripts for playlist UI and page metadata |
| Your API origin | Chapter generation backend |

## Privacy

See [PRIVACY.md](./PRIVACY.md).

## Project Structure

```
src/           # Chrome extension
server/        # API backend (Hono + PostgreSQL + Gemini)
```

## Version

**1.0.0** — see [CHANGELOG.md](./CHANGELOG.md).
