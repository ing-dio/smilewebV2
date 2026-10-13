import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // jsdom gives us a DOM for the integration tests; the pure modules ignore it.
    environment: 'jsdom',
    globals: false,
    include: ['tests/unit/**/*.test.js'],
    exclude: ['node_modules/**', 'tests/e2e/**'],
    reporters: ['default'],
    testTimeout: 15_000,
  },
});
