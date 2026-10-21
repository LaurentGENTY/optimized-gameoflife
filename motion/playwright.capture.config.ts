import { defineConfig } from '@playwright/test'

// Records the real app for scene 4 (npm run capture), in the film's 16:10 format.
export default defineConfig({
  testDir: 'e2e-capture',
  timeout: 300_000,
  workers: 1,
  use: {
    channel: 'chrome',
    baseURL: 'http://localhost:4173',
    headless: true,
    viewport: { width: 1440, height: 900 },
    // The spec records with page.screencast from the Play click: the clip must start when the
    // simulation does, so that `-ss 1` in `npm run capture` trims exactly the first second of play.
    video: 'off',
  },
  webServer: {
    // vite preview sends the COOP/COEP headers that wasm-mt's SharedArrayBuffer needs.
    command: 'npm --prefix ../web run build && npm --prefix ../web run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 180_000,
  },
})
