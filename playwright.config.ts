import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './browser-tests',
  timeout: 60000,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4183', headless: true, trace: 'retain-on-failure', ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) },
  webServer: { command: 'npm run dev -- --port 4183', url: 'http://127.0.0.1:4183', reuseExistingServer: false, timeout: 30000 },
});
