import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the build works under https://<user>.github.io/<repo>/
  base: './',
  worker: { format: 'es' },
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
