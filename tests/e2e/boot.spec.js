import { expect, test } from '@playwright/test';

test.describe('boot + shell', () => {
  test('renders the page, the joke library size and a first joke', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/');

    await expect(page).toHaveTitle(/SmileWeb/);
    await expect(page.locator('html')).toHaveAttribute('data-js', 'on');

    // The dataset total is wired into the hero + footer.
    const totalText = await page.locator('[data-bind="total-jokes"]').first().innerText();
    const total = Number(totalText.replace(/[^0-9]/g, ''));
    expect(total).toBeGreaterThanOrEqual(10_000);

    // The category filter is populated from the manifest.
    const options = page.locator('#category-select option');
    expect(await options.count()).toBeGreaterThanOrEqual(8);

    // A joke is served on boot, even without the camera.
    await expect(page.locator('#joke-card')).toHaveAttribute('data-empty', 'false');
    await expect(page.locator('#joke-setup')).not.toBeEmpty();
    await expect(page.locator('#joke-category')).not.toHaveText('Welcome');

    expect(errors).toEqual([]);
  });

  test('serves production security headers', async ({ request }) => {
    const response = await request.get('/');
    expect(response.ok()).toBe(true);
    const headers = response.headers();
    expect(headers['content-security-policy']).toContain("default-src 'self'");
    expect(headers['permissions-policy']).toContain('camera=(self)');
    expect(headers['x-content-type-options']).toBe('nosniff');
  });
});

test.describe('theme', () => {
  test('cycles auto → light → dark → auto', async ({ page }) => {
    await page.goto('/');
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-theme', 'auto');

    await page.locator('#theme-toggle').click();
    await expect(html).toHaveAttribute('data-theme', 'light');

    await page.locator('#theme-toggle').click();
    await expect(html).toHaveAttribute('data-theme', 'dark');

    await page.locator('#theme-toggle').click();
    await expect(html).toHaveAttribute('data-theme', 'auto');
  });
});

test.describe('keyboard shortcuts', () => {
  test('supports next joke, search focus, theme and the info dialog', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#joke-card')).toHaveAttribute('data-empty', 'false');

    // Space -> next joke.
    const before = await page.locator('#joke-id').innerText();
    await page.locator('body').press('Space');
    await expect
      .poll(async () => page.locator('#joke-id').innerText())
      .not.toBe(before);

    // "/" jumps to the search field.
    await page.locator('body').press('/');
    await expect(page.locator('#search-input')).toBeFocused();

    // "d" switches the theme (blur search first so the key isn't typed into it).
    await page.locator('#search-input').blur();
    await page.locator('body').press('d');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    // The info dialog opens and Escape closes it.
    await page.getByRole('button', { name: /keyboard shortcuts/i }).click();
    await expect(page.locator('#info-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#info-dialog')).toBeHidden();
  });
});

test.describe('accessibility scaffolding', () => {
  test('has landmarks, a skip link and live regions', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('a.skip-link')).toHaveAttribute('href', '#main');
    await expect(page.locator('main#main')).toHaveCount(1);
    await expect(page.locator('header.site-header')).toHaveCount(1);
    await expect(page.locator('footer.site-footer')).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.locator('#status')).toHaveAttribute('role', 'status');
    await expect(page.locator('#smile-meter')).toHaveAttribute('role', 'progressbar');
  });
});
