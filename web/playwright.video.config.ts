import { defineConfig } from '@playwright/test';

// Records the demo videos (npm run video). 1024×640 is the portfolio card format.
export default defineConfig({
  testDir: 'e2e-video',
  timeout: 900_000,
  workers: 1,
  use: {
    channel: 'chrome',
    baseURL: 'http://localhost:4173',
    headless: true,
    viewport: { width: 1024, height: 640 },
    video: { mode: 'on', size: { width: 1024, height: 640 } },
  },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
