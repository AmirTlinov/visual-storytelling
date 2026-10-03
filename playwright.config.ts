import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:8794', viewport: { width: 960, height: 1000 } },
  webServer: {
    command: 'node tools/scene.mjs preview site --port 8794',
    url: 'http://127.0.0.1:8794',
  },
});
