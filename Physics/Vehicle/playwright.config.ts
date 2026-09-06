import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', timeout: 45000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:4181', viewport: { width: 1440, height: 1000 } },
  webServer: { command: 'npm run dev -- --port 4181', url: 'http://127.0.0.1:4181', reuseExistingServer: !process.env.CI },
});
