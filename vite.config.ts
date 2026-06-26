import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { crx } from '@crxjs/vite-plugin'

export default defineConfig(async ({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const manifest = (await import('./src/manifest.ts')).default

  return {
    plugins: [react(), tailwindcss(), crx({ manifest })],
    define: {
      __API_BASE_URL__: JSON.stringify(env.VITE_API_BASE_URL ?? 'http://localhost:3001'),
      __EXTENSION_API_TOKEN__: JSON.stringify(env.VITE_EXTENSION_API_TOKEN ?? ''),
    },
  }
})
