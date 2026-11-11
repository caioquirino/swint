import { expect, test } from '@playwright/test';
import { signInAsInterviewer } from './support/auth.js';

/** The rendered height of Excalidraw inside the template editor's starting board. */
const boardHeight = (page: import('@playwright/test').Page) =>
  page
    .getByTestId('seed-board')
    .locator('.excalidraw')
    .evaluate((el) => el.getBoundingClientRect().height);

test('the starting board fills its tab, and never collapses below its minimum height', async ({ page }) => {
  await signInAsInterviewer(page);
  await page.goto('/templates/new?tab=board');
  await expect(page.getByTestId('seed-board')).toBeVisible();
  // Fills the tab: well beyond the 320px minimum in the 900px-high test viewport.
  await expect.poll(() => boardHeight(page)).toBeGreaterThan(500);

  // If the page above stops passing a definite height down (as with a stale or changed layout),
  // the board must fall back to its minimum height instead of collapsing to nothing.
  await page.locator('form').evaluate((form) => {
    (form as HTMLElement).style.height = 'auto';
  });
  await expect.poll(() => boardHeight(page)).toBeGreaterThanOrEqual(300);
});
