import { defineConfig } from '@playwright/test';

// Local only: CI runners have no GPU, so WebGPU engines cannot run there.
export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  use: { channel: 'chrome', baseURL: 'http://localhost:4173', headless: true },
  webServer: { command: 'npm run build && npm run preview -- --port 4173 --strictPort', url: 'http://localhost:4173', reuseExistingServer: true, timeout: 180_000 },
});
