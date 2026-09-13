import { readdirSync } from 'node:fs';
import { test, expect } from '@playwright/test';

test('archive reads restored PDF with local worker and navigates every view', async ({ page }) => {
  const remote: string[] = [];
  const expectedIssues = readdirSync('archive-data/archive/2000', { withFileTypes: true }).filter(entry => entry.isDirectory()).length;
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:4183') && !request.url().startsWith('data:')) remote.push(request.url()); });
  await page.goto('/');
  await expect.poll(() => page.locator('.issue-card').count()).toBe(expectedIssues);
  await page.locator('.cover-button').first().click();
  await expect(page.locator('.sheet-inner canvas')).toBeVisible();
  await expect.poll(() => page.locator('.sheet-inner canvas').evaluate((c: HTMLCanvasElement) => c.width)).toBeGreaterThan(100);
  await page.getByRole('button', { name: 'Развороты', exact: true }).click();
  const first = page.locator('.spread').first().locator('.canvas-wrap');
  const paired = page.locator('.spread').nth(1).locator('.canvas-wrap').first();
  const firstBox = await first.boundingBox(), pairBox = await paired.boundingBox();
  expect(Math.abs(firstBox!.width - pairBox!.width)).toBeLessThan(3);
  await page.locator('.thumbnails .thumbnail').nth(7).click();
  await expect(page.locator('.thumbnails .thumbnail').nth(7)).toHaveAttribute('aria-current', 'page');
  await expect.poll(() => page.locator('.sheet-viewport').evaluate(e => e.scrollTop)).toBeGreaterThan(400);
  await page.getByRole('button', { name: 'Лента', exact: true }).click();
  await page.locator('.thumbnails .thumbnail').nth(10).click();
  await expect(page).toHaveURL(/-p11$/);
  await expect.poll(() => page.locator('.sheet-viewport').evaluate(e => e.scrollTop)).toBeGreaterThan(400);
  expect(remote).toEqual([]);
});

test('year deep link and mobile layout remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#year-2002');
  await expect(page.locator('.issue-card')).toHaveCount(1);
  await expect(page.locator('.year-picker .selected')).toHaveText('2002');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.locator('.cover-button').click();
  await expect(page.locator('.sheet-inner canvas')).toBeVisible();
});

test('public host navigates to Pages login rather than fetching protected API', async ({ page, request }) => {
  await page.route('http://pilot-archive.test/**', async route => {
    const url = new URL(route.request().url());
    await route.fulfill({ response: await request.get(`http://127.0.0.1:4183${url.pathname}${url.search}`) });
  });
  await page.route('https://pilot-archive.pages.dev/api/admin/login', route => route.fulfill({ contentType: 'text/html', body: 'Вход в архив' }));
  await page.goto('http://pilot-archive.test/');
  await page.locator('.header-add').click();
  await expect(page).toHaveURL('https://pilot-archive.pages.dev/api/admin/login');
});
