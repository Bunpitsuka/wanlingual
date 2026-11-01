import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const micWav = path.join(root, 'tests/fixtures/mic10s.wav');
const exe = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;

export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  retries: 0,
  reporter: [['list']],
  webServer: { command: 'python3 -m http.server 4173 --directory app', url: 'http://127.0.0.1:4173/', reuseExistingServer: true, cwd: root },
  use: { baseURL: 'http://127.0.0.1:4173/', trace: 'retain-on-failure' },
  projects: [
    {
      name: 'android-chrome',
      use: {
        ...devices['Pixel 7'],
        launchOptions: { executablePath: exe, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${micWav}`, '--autoplay-policy=no-user-gesture-required'] },
        permissions: ['microphone'],
      },
    },
    {
      name: 'iphone-safari-emulated',
      // Chromium に iPhone の寸法・UA を当てたエミュレーション（本物の WebKit ではない点に注意）
      use: {
        ...devices['iPhone 14'], defaultBrowserType: 'chromium',
        launchOptions: { executablePath: exe, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${micWav}`, '--autoplay-policy=no-user-gesture-required'] },
        permissions: ['microphone'],
      },
    },
  ],
});
