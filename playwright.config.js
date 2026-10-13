import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * Playwright configuration.
 *
 * We drive the system Chromium (`/usr/bin/chromium`) rather than downloading a
 * managed browser, and we always run against the project's own static server so
 * the production headers (CSP, Permissions-Policy) are exercised too.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    video: 'off',
    screenshot: 'only-on-failure',
    // A deterministic viewport makes screenshot-free layout assertions stable.
    viewport: { width: 1280, height: 900 },
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
          args: [
            // Allow getUserMedia without a prompt, and provide a synthetic device
            // in case a test does not stub the camera itself.
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            '--autoplay-policy=no-user-gesture-required',
            '--disable-renderer-backgrounding',
            '--disable-backgrounding-occluded-windows',
            '--disable-background-timer-throttling',
            '--no-sandbox',
          ],
        },
      },
    },
  ],

  webServer: {
    command: `node scripts/serve.mjs --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
