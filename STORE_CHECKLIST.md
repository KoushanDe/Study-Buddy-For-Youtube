# Chrome Web Store Submission Checklist

## Pre-submission

- [ ] Deploy backend API with `GEMINI_API_KEY` and `EXTENSION_API_TOKEN` set
- [ ] Build extension with production `VITE_API_BASE_URL` and `VITE_EXTENSION_API_TOKEN`
- [ ] Run `npm run build` successfully
- [ ] Run `npm run package` to create `study-buddy-for-youtube.zip`
- [ ] Manually test (see [SMOKE_TEST.md](./SMOKE_TEST.md)):
  - [ ] Playlist page shows duration card
  - [ ] Video page popup shows AI chapters
  - [ ] AI chapters generate via backend with accurate timestamps
  - [ ] Chapter click seeks video
  - [ ] Progress bar shows during generation
  - [ ] Regenerate flow (reason, feedback, quota)

## Store listing assets

- [ ] **Icon** — 128x128 PNG (`public/icons/icon128.png`)
- [ ] **Screenshots** — Playlist duration card + AI chapters popup
- [ ] **Privacy policy URL** — Host `PRIVACY.md` and link in listing

## Permission justifications

| Permission | Justification |
|---|---|
| `storage` | Cache playlist durations, transcripts, chapters, and user settings locally |
| `tabs` | Send seek-to-timestamp commands to the active YouTube tab |
| `youtube.com` | Inject playlist duration UI and read page metadata |
| Your API domain | Call developer-operated backend for AI chapter generation |

## Privacy disclosures

- Transcript fetched locally in the browser; video ID, metadata, and transcript text sent to developer backend for AI chapter generation (native YouTube chapters stay local)
- Backend uses Google Gemini API with server-side key
- No user API keys required
- Link to [PRIVACY.md](./PRIVACY.md)

## Submit

1. Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. Upload `study-buddy-for-youtube.zip`
3. Complete store listing
4. Submit for review
