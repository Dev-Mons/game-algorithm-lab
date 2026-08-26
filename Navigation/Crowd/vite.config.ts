import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  server: { host: '127.0.0.1', port: 4173 },
  test: {
    exclude: ['tests/browser/**', 'node_modules/**', 'dist/**'],
  },
});
