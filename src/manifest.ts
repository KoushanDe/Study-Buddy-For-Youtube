import { defineManifest } from '@crxjs/vite-plugin'

const API_BASE_URL = process.env.VITE_API_BASE_URL ?? 'http://localhost:3001'

function getApiHostPermission(): string {
  try {
    return `${new URL(API_BASE_URL).origin}/*`
  } catch {
    return 'http://localhost:3001/*'
  }
}

export default defineManifest({
  manifest_version: 3,
  name: 'Study Buddy for YouTube',
  version: '1.0.1',
  description:
    'Consume long YouTube playlists and videos efficiently with playlist duration totals and AI-generated chapters.',
  permissions: ['storage', 'tabs'],
  host_permissions: ['https://www.youtube.com/*', getApiHostPermission()],
  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['https://www.youtube.com/*'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
    },
    {
      matches: ['https://www.youtube.com/*'],
      js: ['src/content/main-world/player-response.ts'],
      world: 'MAIN',
      run_at: 'document_start',
    },
    {
      matches: ['https://www.youtube.com/*'],
      js: ['src/content/main-world/transcript-fetcher.ts'],
      world: 'MAIN',
      run_at: 'document_idle',
    },
  ],
  action: {
    default_popup: 'src/popup/index.html',
    default_title: 'Study Buddy for YouTube',
  },
  icons: {
    16: 'public/icons/icon16.png',
    48: 'public/icons/icon48.png',
    128: 'public/icons/icon128.png',
  },
})
