import { defineConfig } from '@playwright/test';
// 창을 띄우지 않는 새 헤드리스 모드(channel: chromium)에서 가능한 경우 하드웨어 GPU를 사용한다.
export default defineConfig({
  testDir: './tests/browser', timeout: 120000, workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4191', viewport: { width: 1440, height: 900 }, headless: true, channel: 'chromium',
    launchOptions: { args: ['--ignore-gpu-blocklist', '--enable-gpu', ...(process.platform === 'win32' ? ['--use-angle=d3d11'] : [])] },
  },
  webServer: { command: 'npm run dev -- --port 4191', url: 'http://127.0.0.1:4191', reuseExistingServer: !process.env.CI },
});
