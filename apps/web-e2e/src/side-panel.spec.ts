import { expect, test } from '@playwright/test';
import { signInAsInterviewer } from './support/auth.js';
import { drawRectangle } from './support/board.js';
import { createSession, uniqueCandidate } from './support/sessions.js';

test('the side panel resizes, collapses and keeps the board usable', async ({ page }) => {
  await signInAsInterviewer(page);
  const session = await createSession(page, uniqueCandidate());
  await page.goto(session.roomPath);
  await page.getByRole('button', { name: 'Start interview' }).click();

  const aside = page.locator('aside');
  const board = page.getByTestId('board');
  await expect(board).toBeVisible();
  const width = async (l: typeof aside) => (await l.boundingBox())?.width ?? NaN;

  const asideBefore = await width(aside);
  const boardBefore = await width(board);

  // Drag the separator 120 px to the right.
  const handle = await page.getByRole('separator', { name: 'Resize side panel' }).boundingBox();
  if (!handle) throw new Error('separator is not visible');
  const x = handle.x + handle.width / 2;
  const y = handle.y + handle.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 120, y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => width(aside)).toBeGreaterThan(asideBefore + 116);
  expect(await width(aside)).toBeLessThan(asideBefore + 124);
  expect(await width(board)).toBeLessThan(boardBefore);
  const asideResized = await width(aside);

  // The width persists across a reload.
  await page.reload();
  await expect(page.getByTestId('board')).toBeVisible();
  expect(Math.abs((await width(aside)) - asideResized)).toBeLessThanOrEqual(4);

  // Collapse: the tabs go away and the board grows.
  const boardNarrow = await width(board);
  await page.getByRole('button', { name: 'Collapse side panel' }).click();
  await expect(page.getByRole('tab', { name: 'Instructions' })).toBeHidden();
  await expect.poll(() => width(board)).toBeGreaterThan(boardNarrow);

  // Expand restores the width.
  await page.getByRole('button', { name: 'Expand side panel' }).click();
  await expect(page.getByRole('tab', { name: 'Instructions' })).toBeVisible();
  expect(Math.abs((await width(aside)) - asideResized)).toBeLessThanOrEqual(4);

  // The board still accepts drawing after the resize and collapse.
  const elementCount = async () => Number(await board.getAttribute('data-element-count'));
  await expect.poll(elementCount).toBeGreaterThan(0);
  const baseline = await elementCount();
  await drawRectangle(page);
  await expect(board).toHaveAttribute('data-element-count', String(baseline + 1));
});
