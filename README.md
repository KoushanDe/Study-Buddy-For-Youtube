# Study Buddy for YouTube

Chrome Extension (Manifest V3) that helps you consume long YouTube playlists and videos efficiently.

## Features

- **Playlist Duration** — Shows total playlist watch time at 1x, 1.25x, 1.5x, and 2x playback speeds on playlist pages
- **AI Chapters** — Generates semantic chapters with accurate timestamps for any video, shown in the extension popup
- **Caching** — Caches playlist durations, transcripts, and generated chapters locally

## Tech Stack

- Chrome Extension Manifest V3 (popup UI)
- TypeScript + React + Vite + Tailwind CSS
- Node.js backend (Hono) with **Gemini 2.5 Flash**
- Chrome Storage API

## Setup

### 1. Backend (chapter generation only)

```bash
cd server
cp .env.example .env
# Set GEMINI_API_KEY and EXTENSION_API_TOKEN
npm install
npm run dev
```

The API runs at `http://localhost:3001` and exposes `/api/chapters` (Gemini).

### 2. Extension

```bash
cp .env.example .env
# Set VITE_API_BASE_URL and VITE_EXTENSION_API_TOKEN (must match server token)
npm install
npm run dev
```

Load the `dist/` folder as an unpacked extension in `chrome://extensions`.

### Production

1. Deploy the `server/` app (Railway, Fly.io, Render, etc.)
2. Set `GEMINI_API_KEY` and `EXTENSION_API_TOKEN` as server secrets
3. Build the extension with your production API URL:

```bash
VITE_API_BASE_URL=https://api.yourdomain.com VITE_EXTENSION_API_TOKEN=your-token npm run build
```

## Usage

### Playlist Duration
Open any YouTube playlist (`/playlist?list=...`), click the extension icon, and expand **Playlist duration** to see watch-time totals.

### AI Chapters
1. Start the backend server (requires `GEMINI_API_KEY`)
2. Open a YouTube video (`/watch?v=...`)
3. Click the extension icon and expand **AI chapters**

Chapter resolution order:
1. **YouTube native chapters** (if the creator added them) — shown as-is, no AI
2. **Transcript → AI chapters** via Gemini (two-pass: boundary detection, then titling)

Click any chapter to seek.

## Architecture

```
Popup
  → Service Worker
    → Content script fetches transcript on youtube.com (client-side)
    → POST /api/chapters (transcript chunks → Gemini 2.5 Flash)
  → Chapters returned to popup
```

Users never provide API keys. The backend holds the Gemini key and validates requests with a shared extension token. Transcripts stay in the browser unless sent as text for chapter generation.

## Permissions

| Permission | Purpose |
|---|---|
| `storage` | Cache data and save settings locally |
| `tabs` | Relay seek commands to the active YouTube tab |
| `youtube.com` | Content scripts for playlist UI and page metadata |
| Your API origin | Call the chapter generation backend |

## Privacy

See [PRIVACY.md](./PRIVACY.md).

## Project Structure

```
src/           # Chrome extension (transcript + UI)
server/        # Gemini chapter API backend
```
