import { defineConfig } from 'vitest/config'

export default defineConfig({
  server: {
    // The bench JSON files live in ../bench, outside the package root.
    fs: { allow: ['..'] },
  },
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
})
