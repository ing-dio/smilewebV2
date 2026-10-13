import { expect, test } from '@playwright/test';

/**
 * The full camera → face model → smile tracker → UI loop.
 *
 * A real webcam and the 4 MB MediaPipe model are not available in CI, so we
 * install two deterministic seams before the app boots:
 *
 *   1. `navigator.mediaDevices.getUserMedia` yields a canvas-backed stream, so
 *      the video element gets real dimensions immediately.
 *   2. `globalThis.__smilewebTestDetectorFactory` returns a fake detector whose
 *      smile score is controlled by `globalThis.__smilewebTestScore`.
 */
async function installCameraStubs(page) {
  await page.addInitScript(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#6b7280';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const stream = canvas.captureStream(30);

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => stream },
    });

    globalThis.__smilewebTestScore = 0;
    globalThis.__smilewebTestDetectorFactory = async () => ({
      ready: true,
      close() {},
      detect() {
        const score = globalThis.__smilewebTestScore;
        return {
          faceCount: 1,
          landmarks: [
            { x: 0.4, y: 0.35 },
            { x: 0.6, y: 0.65 },
          ],
          categories: [
            { categoryName: 'mouthSmileLeft', score },
            { categoryName: 'mouthSmileRight', score },
            { categoryName: 'jawOpen', score: 0 },
          ],
          box: { x: 0.32, y: 0.28, width: 0.36, height: 0.44 },
        };
      },
    });
  });
}

test.describe('smile → joke loop', () => {
  test('asks for consent, starts tracking and celebrates a real smile', async ({ page }) => {
    await installCameraStubs(page);
    await page.goto('/');

    await page.locator('#start-button').click();
    await expect(page.locator('#consent-dialog')).toBeVisible();
    await page.locator('#consent-dialog button[value="allow"]').click();

    // The session starts and the camera controls appear.
    await expect(page.locator('#viewport-badge')).toBeVisible();
    await expect(page.locator('#pause-button')).toBeVisible();
    await expect(page.locator('#stop-button')).toBeVisible();
    await expect(page.locator('#status')).toContainText(/smile|camera|tracking/i);

    // Hold a big grin: the tracker smoothing + hold window needs a moment.
    await page.evaluate(() => {
      globalThis.__smilewebTestScore = 1;
    });

    await expect(page.locator('#celebrate')).not.toBeEmpty({ timeout: 15_000 });
    await expect(page.locator('#celebrate')).toContainText(/smil/i);

    // A smile records a stat and serves a fresh joke.
    await expect(page.locator('#stat-today')).not.toHaveText('0');
    await expect(page.locator('#joke-card')).toHaveAttribute('data-fresh', 'true');
    await expect(page.locator('#joke-setup')).not.toBeEmpty();
    await expect(page.locator('#stat-total')).not.toHaveText('0');
  });

  test('pauses and resumes tracking', async ({ page }) => {
    await installCameraStubs(page);
    await page.goto('/');

    await page.locator('#start-button').click();
    await page.locator('#consent-dialog button[value="allow"]').click();
    await expect(page.locator('#pause-button')).toBeVisible();

    await page.locator('#pause-button').click();
    await expect(page.locator('#pause-button')).toHaveText(/resume/i);
    await expect(page.locator('#status')).toContainText(/paused/i);

    await page.locator('#pause-button').click();
    await expect(page.locator('#pause-button')).toHaveText(/pause/i);

    await page.locator('#stop-button').click();
    await expect(page.locator('#stop-button')).toBeHidden();
    await expect(page.locator('#start-button')).toBeVisible();
    await expect(page.locator('#status')).toContainText(/camera is off/i);
  });

  test('remembers consent and skips the dialog on the next start', async ({ page }) => {
    await installCameraStubs(page);
    await page.goto('/');

    await page.locator('#start-button').click();
    await page.locator('#consent-dialog button[value="allow"]').click();
    await expect(page.locator('#stop-button')).toBeVisible();
    await page.locator('#stop-button').click();

    await page.locator('#start-button').click();
    await expect(page.locator('#consent-dialog')).toBeHidden();
    await expect(page.locator('#stop-button')).toBeVisible();
  });
});
