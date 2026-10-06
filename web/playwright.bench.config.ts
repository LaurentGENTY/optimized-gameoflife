import { defineConfig } from '@playwright/test';

// Runs the in-app benchmark in a page that stays visible (hidden tabs are throttled).
export default defineConfig({
  testDir: 'e2e-bench',
  timeout: 1_800_000,
  use: { channel: 'chrome', baseURL: 'http://localhost:4173', headless: true },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
