# Privacy Policy — Study Buddy for YouTube

**Last updated:** June 18, 2026

Study Buddy for YouTube is a Chrome extension with an optional backend API operated by the extension developer.

## Data Collection

The extension developer does not sell personal data. The extension stores preferences and cache data locally in your browser.

## Local Storage

The extension uses `chrome.storage.local` to store:

- Your enabled/disabled preference
- Cached playlist durations, transcripts, and generated chapters

This data stays on your device unless sent as described below.

## Data Sent to Third Parties

### YouTube
The extension reads public YouTube page content and caption data while you browse `youtube.com`.

### Developer Backend
When you use AI chapters, the video ID and metadata (title, duration) are sent to the Study Buddy for YouTube backend API, which fetches the video's transcript and generates chapter titles. This is required for the feature to work.

### Google Gemini
The backend sends transcript excerpts to Google's Gemini API to generate chapters when the creator has not added their own.

## Permissions

- **storage** — Save settings and cache locally
- **tabs** — Seek the active YouTube video when you click a chapter
- **host permissions** — Access YouTube pages and the chapter API backend

## Contact

For privacy questions, open an issue in the project repository.
