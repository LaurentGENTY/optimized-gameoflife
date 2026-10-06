import { defineConfig } from 'vitest/config';

// SharedArrayBuffer (WASM threads) needs cross-origin isolation.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  // Relative base so the build works under https://<user>.github.io/<repo>/
  base: './',
  worker: { format: 'es' },
  server: { headers: isolation, fs: { allow: ['..'] } },
  preview: { headers: isolation },
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
