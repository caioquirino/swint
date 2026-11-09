import type { Page } from '@playwright/test';

/** Draws one rectangle in the middle of the board with Excalidraw's rectangle tool. */
export async function drawRectangle(page: Page): Promise<void> {
  // Excalidraw's tool is a radio input overlaid by its label icon, which intercepts the pointer.
  await page.getByTestId('toolbar-rectangle').click({ force: true });
  const box = await page.getByTestId('board').boundingBox();
  if (!box) throw new Error('board is not visible');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x - 80, y - 50);
  await page.mouse.down();
  await page.mouse.move(x + 80, y + 50, { steps: 8 });
  await page.mouse.up();
}
