import { test, expect } from '@playwright/test';

test('an issue deep link asks for age first and remembers the answer', async ({ page }) => {
  const pdfRequests: string[] = [];
  page.on('request', request => { if (request.url().endsWith('.pdf')) pdfRequests.push(request.url()); });
  await page.goto('/#year-2000');
  await page.waitForLoadState('networkidle');
  const gate = page.getByRole('dialog', { name: 'Архив для взрослых читателей' });
  await expect(gate).toBeVisible();
  await expect(page.locator('.issue-card')).toHaveCount(0);
  expect(pdfRequests).toEqual([]);

  await gate.getByRole('button', { name: 'Мне нет 18' }).click();
  await expect(gate).toContainText('Архив доступен только читателям старше 18 лет.');
  await expect(page.locator('.issue-card')).toHaveCount(0);

  await page.reload();
  await page.getByRole('button', { name: 'Мне есть 18 лет' }).click();
  await expect(page.locator('.issue-card').first()).toBeVisible();
  await expect(page.locator('.site-header .adult-badge')).toHaveText('18+');

  await page.reload();
  await expect(page.locator('.issue-card').first()).toBeVisible();
  await page.locator('.cover-button').first().click();
  await expect(page.locator('.reader-title .adult-badge')).toHaveText('18+');
});

test('the age gate fits a phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Мне есть 18 лет' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
