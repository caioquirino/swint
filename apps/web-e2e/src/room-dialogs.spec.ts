import { expect, test, type Locator } from '@playwright/test';
import { signInAsInterviewer } from './support/auth.js';
import { createSession, uniqueCandidate } from './support/sessions.js';

/**
 * Whether the dialog is the topmost painted element at its centre. A modal Radix dialog sets
 * `pointer-events: none` on <body>, so clicks fall through anything painted over it; lift that
 * before hit-testing so a board drawn on top is detected.
 */
const isOnTop = (dialog: Locator) =>
  dialog.evaluate((el) => {
    const previous = document.body.style.pointerEvents;
    document.body.style.pointerEvents = 'auto';
    try {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return hit !== null && el.contains(hit);
    } finally {
      document.body.style.pointerEvents = previous;
    }
  });

test('room dialogs open above the board', async ({ page }) => {
  await signInAsInterviewer(page);
  const session = await createSession(page, uniqueCandidate());
  await page.goto(session.roomPath);
  await expect(page.getByTestId('board').locator('canvas').first()).toBeVisible();

  await page.getByRole('button', { name: 'Cancel…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Cancel interview' });
  await expect(dialog).toBeVisible();
  expect(await isOnTop(dialog)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});
