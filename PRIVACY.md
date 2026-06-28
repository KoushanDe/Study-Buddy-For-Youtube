# Privacy Policy — Study Buddy for YouTube

**Last updated:** June 28, 2026

Study Buddy for YouTube is a Chrome extension with an optional backend API operated by the extension developer.

## Data Collection

The extension developer does not sell personal data. The extension stores preferences and cache data locally in your browser.

## Local Storage

The extension uses `chrome.storage.local` to store:

- Your enabled/disabled preference
- A random anonymous install ID (UUID) used to enforce regenerate limits on the server
- Cached playlist durations, transcripts, and generated chapters

This data stays on your device unless sent as described below.

## Data Sent to Third Parties

### YouTube
The extension reads public YouTube page content and caption data while you browse `youtube.com`.

### Developer Backend
When you use AI chapters on a video without creator-added chapters, the extension fetches the transcript locally in your browser from YouTube caption data. The video ID, metadata (title, duration), and transcript text are then sent to the Study Buddy for YouTube backend API to generate chapter titles.

Generated chapters may be cached on the server by video ID so other users can benefit from prior generation. If you regenerate with a nuanced preference and approve the result, your personalized chapters for that video are stored on the server keyed by your anonymous install ID and the video ID. The server does not receive your Google account or name.

When you use **Regenerate**, the extension also sends your anonymous install ID and a short reason you provide (up to 100 characters). Regeneration reasons and staged results are stored temporarily on the server until you submit feedback.

### Google Gemini
The backend sends transcript excerpts to Google's Gemini API to generate chapters when the creator has not added their own. Regenerate reasons are validated with a lighter Gemini model. Native YouTube chapters are read locally and are not sent to the backend.

## Permissions

- **storage** — Save settings, anonymous install ID, and cache locally
- **tabs** — Seek the active YouTube video when you click a chapter
- **host permissions** — Access YouTube pages and the chapter API backend

## Contact

For privacy questions, open an issue in the project repository.
