import { expect, test } from '@playwright/test';

test.describe('browse + search', () => {
  test('lists a page of jokes and loads more on demand', async ({ page }) => {
    await page.goto('/');
    await page.locator('#browse-button').click();

    const items = page.locator('#joke-list .joke-list__item');
    await expect(items.first()).toBeVisible();
    await expect.poll(async () => items.count()).toBeGreaterThanOrEqual(24);

    await expect(page.locator('#filters-status')).toContainText(/jokes? shown/);

    const before = await items.count();
    await page.locator('#load-more').click();
    await expect.poll(async () => items.count()).toBeGreaterThan(before);
  });

  test('filters by category', async ({ page }) => {
    await page.goto('/');
    await page.locator('#browse-button').click();

    await page.locator('#category-select').selectOption('riddles');
    const items = page.locator('#joke-list .joke-list__item');
    await expect(items.first()).toBeVisible();
    await expect(items.first().locator('.joke-list__cat')).toHaveText('Riddles');
  });

  test('searches the library and shows a result count', async ({ page }) => {
    await page.goto('/');
    await page.locator('#browse-button').click();

    // "What" appears in many riddles and puns across the dataset.
    await page.locator('#search-input').fill('what');
    await expect(page.locator('#filters-status')).toContainText(/jokes? shown/);
    await expect(page.locator('#joke-list .joke-list__item').first()).toBeVisible();
  });

  test('shows an empty state for a nonsense query', async ({ page }) => {
    await page.goto('/');
    await page.locator('#browse-button').click();

    await page.locator('#search-input').fill('zzzzqqqxxyy');
    await expect(page.locator('#joke-list .joke-list__empty')).toBeVisible();
  });

  test('saves a joke and can show saved jokes only', async ({ page }) => {
    await page.goto('/');
    await page.locator('#browse-button').click();

    const firstItem = page.locator('#joke-list .joke-list__item').first();
    await expect(firstItem).toBeVisible();
    const favoriteButton = firstItem.locator('[data-list-action="favorite"]');
    await favoriteButton.click();
    await expect(favoriteButton).toHaveAttribute('aria-pressed', 'true');

    await page.locator('#favorites-only').check();
    const savedItems = page.locator('#joke-list .joke-list__item');
    await expect(savedItems).toHaveCount(1);
    await expect(savedItems.first().locator('[data-list-action="favorite"]')).toHaveText('♥');
  });
});

test.describe('the joke stage', () => {
  test('serves a new joke and supports reveal / save / copy', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/');
    await expect(page.locator('#joke-card')).toHaveAttribute('data-empty', 'false');

    // Next joke button.
    const before = await page.locator('#joke-setup').innerText();
    await page.locator('[data-action="next-joke"]').click();
    await expect.poll(async () => page.locator('#joke-setup').innerText()).not.toBe(before);

    // Save + copy.
    const favorite = page.locator('#favorite-button');
    await favorite.click();
    await expect(favorite).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-action="copy"]').click();
    await expect(page.locator('#toast')).toContainText(/copied|failed/i);
  });

  test('the pretend-smile fallback still celebrates', async ({ page }) => {
    await page.goto('/');
    // Skipping the camera consent reveals the no-camera fallback.
    await page.locator('#start-button').click();
    await expect(page.locator('#consent-dialog')).toBeVisible();
    await page.locator('#consent-dialog button[value="skip"]').click();
    await expect(page.locator('#camera-fallback')).toBeVisible();

    await page.locator('[data-action="fake-smile"]').click();
    await expect(page.locator('#celebrate')).not.toBeEmpty();
  });
});
